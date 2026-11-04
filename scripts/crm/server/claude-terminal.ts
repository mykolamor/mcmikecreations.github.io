// The Claude tab's terminal: one Claude Code process for the whole CRM, run in the repo root on this machine. It belongs
// to the server, not the page: switching tabs, opening another hike or reloading reattaches to the same session. A
// headless xterm mirrors its screen, so a page that (re)attaches gets the screen and scrollback as they are now.
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';

/** What the server sends a page. `snapshot` comes first on attach: the screen as it is, then `output` as it grows. */
export type ServerMsg =
	| { type: 'snapshot'; data: string; running: boolean; exitCode: number | null }
	| { type: 'output'; data: string }
	| { type: 'exit'; exitCode: number };
/** What a page sends: keystrokes, its terminal size, and "Start again" after Claude exited. */
export type ClientMsg = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | { type: 'start' };

export type Pty = {
	onData(cb: (data: string) => void): void;
	onExit(cb: (e: { exitCode: number }) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
};
export type SpawnPty = (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }) => Pty;
export type Client = { send(msg: ServerMsg): void };

const SCROLLBACK = 5000;
const clampSize = (n: unknown, min: number, max: number, dflt: number) =>
	typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;

/**
 * The environment Claude starts with: the server's, less what would make it think it runs inside another Claude Code
 * session (the CRM may have been started from one), with a colour terminal.
 */
export function claudeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) if (v !== undefined && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')) out[k] = v;
	out.TERM = 'xterm-256color';
	out.COLORTERM = 'truecolor';
	return out;
}

/**
 * A request may reach the terminal only from the CRM's own page: a loopback Host (no DNS rebinding) and, when the
 * browser sends one, an Origin on that same host (no other website's page). A WebSocket always carries an Origin.
 */
export function sameOriginLoopback(headers: { host?: string; origin?: string }, requireOrigin: boolean): boolean {
	const host = headers.host;
	if (!host) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return false;
	}
	if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
	if (headers.origin === undefined) return !requireOrigin;
	try {
		const o = new URL(headers.origin);
		return (o.protocol === 'http:' || o.protocol === 'https:') && o.host === host;
	} catch {
		return false;
	}
}

export class ClaudeTerminal {
	private pty: Pty | null = null;
	private exitCode: number | null = null;
	private term = this.newTerm(80, 24);
	private serializer!: InstanceType<typeof serialize.SerializeAddon>;
	private cols = 80;
	private rows = 24;
	/** Attached pages; a page waiting for its snapshot collects output in its queue meanwhile. */
	private clients = new Map<Client, string[] | null>();

	constructor(
		private opts: {
			root: string;
			spawn: SpawnPty;
			/** Read at each start, so a changed setting applies on "Start again". */
			command: () => string;
			shell?: string;
			env?: NodeJS.ProcessEnv;
		}
	) {}

	private newTerm(cols: number, rows: number) {
		const term = new headless.Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
		this.serializer = new serialize.SerializeAddon();
		term.loadAddon(this.serializer);
		return term;
	}

	get running(): boolean {
		return this.pty !== null;
	}

	/** Starts Claude unless it runs; the screen starts empty. */
	start(): void {
		if (this.pty) return;
		this.term.dispose();
		this.term = this.newTerm(this.cols, this.rows);
		this.exitCode = null;
		const shell = this.opts.shell ?? process.env.SHELL ?? '/bin/sh';
		let pty: Pty;
		try {
			pty = this.opts.spawn(shell, ['-ic', this.opts.command()], {
				cwd: this.opts.root,
				cols: this.cols,
				rows: this.rows,
				env: claudeEnv(this.opts.env ?? process.env)
			});
		} catch (e) {
			const msg = `\r\nCould not start ${shell}: ${e instanceof Error ? e.message : String(e)}\r\n`;
			this.output(msg);
			this.exited(1);
			return;
		}
		this.pty = pty;
		pty.onData((d) => {
			if (this.pty === pty) this.output(d);
		});
		pty.onExit(({ exitCode }) => {
			if (this.pty !== pty) return;
			this.pty = null;
			this.exited(exitCode);
		});
	}

	private output(data: string): void {
		this.term.write(data);
		for (const [c, queue] of this.clients) {
			if (queue) queue.push(data);
			else c.send({ type: 'output', data });
		}
	}

	private exited(exitCode: number): void {
		this.exitCode = exitCode;
		for (const [c, queue] of this.clients) if (!queue) c.send({ type: 'exit', exitCode });
	}

	/** Adds a page at its terminal size; the first page ever starts Claude. It gets the screen once xterm has caught up. */
	attach(client: Client, cols?: number, rows?: number): void {
		this.clients.set(client, []);
		this.resize(cols, rows);
		if (!this.pty && this.exitCode === null) this.start();
		// The headless terminal parses asynchronously: the snapshot is taken once everything written so far is in it;
		// what arrives after is in the page's queue.
		this.term.write('', () => {
			const queue = this.clients.get(client);
			if (!queue) return;
			client.send({ type: 'snapshot', data: this.serializer.serialize(), running: this.running, exitCode: this.exitCode });
			for (const data of queue) client.send({ type: 'output', data });
			this.clients.set(client, null);
		});
	}

	detach(client: Client): void {
		this.clients.delete(client);
	}

	/** The latest page to attach or resize sets the size. */
	resize(cols?: number, rows?: number): void {
		const c = clampSize(cols, 10, 1000, this.cols);
		const r = clampSize(rows, 4, 500, this.rows);
		if (c === this.cols && r === this.rows) return;
		this.cols = c;
		this.rows = r;
		this.term.resize(c, r);
		this.pty?.resize(c, r);
	}

	/** A page's message; anything malformed is ignored. */
	handle(raw: string): void {
		let msg: ClientMsg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		if (msg?.type === 'input' && typeof msg.data === 'string') this.pty?.write(msg.data);
		else if (msg?.type === 'resize') this.resize(msg.cols, msg.rows);
		else if (msg?.type === 'start') {
			if (this.pty) return;
			this.start();
			for (const c of [...this.clients.keys()]) this.attachAgain(c);
		}
	}

	/** After a restart every page gets the new (empty) screen. */
	private attachAgain(client: Client): void {
		this.clients.delete(client);
		this.attach(client);
	}

	/** Ends Claude (the CRM server is stopping). */
	dispose(): void {
		const pty = this.pty;
		this.pty = null;
		pty?.kill();
		this.term.dispose();
		this.clients.clear();
	}
}

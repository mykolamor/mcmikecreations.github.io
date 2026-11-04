import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeTerminal, claudeEnv, sameOriginLoopback, type Pty, type ServerMsg, type SpawnPty } from './claude-terminal';

type FakePty = Pty & { emit(d: string): void; exit(code: number): void; written: string[]; sizes: [number, number][]; killed: boolean };

function fakeSpawn() {
	const calls: { file: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }[] = [];
	const ptys: FakePty[] = [];
	const spawn: SpawnPty = (file, args, opts) => {
		calls.push({ file, args, ...opts });
		let onData: (d: string) => void = () => {};
		let onExit: (e: { exitCode: number }) => void = () => {};
		const p: FakePty = {
			written: [],
			sizes: [],
			killed: false,
			onData: (cb) => (onData = cb),
			onExit: (cb) => (onExit = cb),
			write: (d) => p.written.push(d),
			resize: (c, r) => p.sizes.push([c, r]),
			kill: () => (p.killed = true),
			emit: (d) => onData(d),
			exit: (code) => onExit({ exitCode: code })
		};
		ptys.push(p);
		return p;
	};
	return { spawn, calls, ptys };
}

function client() {
	const got: ServerMsg[] = [];
	return { got, send: (m: ServerMsg) => got.push(m) };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const snapshotText = (m: ServerMsg | undefined) => (m?.type === 'snapshot' ? m.data : '');

test('the first page starts the command through an interactive shell in the repo root', async () => {
	const f = fakeSpawn();
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => 'claude-tum', shell: '/bin/zsh', env: { PATH: '/bin' } });
	t.attach(client(), 120, 40);
	assert.equal(f.calls.length, 1);
	assert.deepEqual([f.calls[0].file, f.calls[0].args, f.calls[0].cwd, f.calls[0].cols, f.calls[0].rows], ['/bin/zsh', ['-ic', 'claude-tum'], '/repo', 120, 40]);
	assert.equal(f.calls[0].env.PATH, '/bin');
	t.dispose();
});

test('a page attaching later gets the screen so far, then live output; a second page starts nothing', async () => {
	const f = fakeSpawn();
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => 'claude' });
	const a = client();
	t.attach(a);
	f.ptys[0].emit('hello ');
	await settle();
	const b = client();
	t.attach(b);
	f.ptys[0].emit('world');
	await settle();
	assert.equal(f.calls.length, 1);
	assert.equal(b.got[0].type, 'snapshot');
	assert.match(snapshotText(b.got[0]), /hello/);
	assert.doesNotMatch(snapshotText(b.got[0]), /world/);
	assert.deepEqual(b.got.slice(1), [{ type: 'output', data: 'world' }]);
	assert.deepEqual(
		a.got.filter((m) => m.type === 'output').map((m) => (m as { data: string }).data),
		['hello ', 'world']
	);
	t.dispose();
});

test('a detached page gets nothing; reattaching shows the same session', async () => {
	const f = fakeSpawn();
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => 'claude' });
	const a = client();
	t.attach(a);
	await settle();
	t.detach(a);
	f.ptys[0].emit('while away');
	await settle();
	assert.equal(a.got.length, 1);
	const again = client();
	t.attach(again);
	await settle();
	assert.match(snapshotText(again.got[0]), /while away/);
	assert.equal(f.calls.length, 1);
	t.dispose();
});

test('input and resize reach the process; malformed messages are ignored', async () => {
	const f = fakeSpawn();
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => 'claude' });
	t.attach(client(), 80, 24);
	t.handle(JSON.stringify({ type: 'input', data: 'hi\r' }));
	t.handle(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
	t.handle('not json');
	t.handle(JSON.stringify({ type: 'input', data: 5 }));
	assert.deepEqual(f.ptys[0].written, ['hi\r']);
	assert.deepEqual(f.ptys[0].sizes, [[100, 30]]);
	t.dispose();
});

test('after Claude exits nothing restarts on its own; "start" starts it again with the current command', async () => {
	const f = fakeSpawn();
	let cmd = 'claude';
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => cmd });
	const a = client();
	t.attach(a);
	await settle();
	f.ptys[0].emit('bye');
	f.ptys[0].exit(0);
	assert.deepEqual(a.got.at(-1), { type: 'exit', exitCode: 0 });
	const later = client();
	t.attach(later);
	await settle();
	assert.equal(f.calls.length, 1);
	assert.deepEqual([later.got[0].type, (later.got[0] as { running: boolean }).running], ['snapshot', false]);
	cmd = 'claude-tum';
	t.handle(JSON.stringify({ type: 'start' }));
	await settle();
	assert.equal(f.calls.length, 2);
	assert.deepEqual(f.calls[1].args, ['-ic', 'claude-tum']);
	const fresh = a.got.at(-1)!;
	assert.equal(fresh.type, 'snapshot');
	assert.equal((fresh as { running: boolean }).running, true);
	assert.doesNotMatch(snapshotText(fresh), /bye/);
	t.handle(JSON.stringify({ type: 'start' }));
	assert.equal(f.calls.length, 2);
	t.dispose();
});

test('dispose kills the process', () => {
	const f = fakeSpawn();
	const t = new ClaudeTerminal({ root: '/repo', spawn: f.spawn, command: () => 'claude' });
	t.attach(client());
	t.dispose();
	assert.equal(f.ptys[0].killed, true);
});

test('a shell that cannot start shows why and counts as exited', async () => {
	const t = new ClaudeTerminal({
		root: '/repo',
		spawn: () => {
			throw new Error('ENOENT');
		},
		command: () => 'claude',
		shell: '/nope'
	});
	const a = client();
	t.attach(a);
	await settle();
	const snap = a.got[0];
	assert.equal(snap.type, 'snapshot');
	assert.equal((snap as { running: boolean }).running, false);
	assert.match(snapshotText(snap), /Could not start \/nope: ENOENT/);
	t.dispose();
});

test('claudeEnv drops the markers of an enclosing Claude Code session', () => {
	const env = claudeEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONFIG_DIR: '/x', TERM: 'dumb' });
	assert.deepEqual(env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/x', TERM: 'xterm-256color', COLORTERM: 'truecolor' });
});

test('sameOriginLoopback: loopback host, origin on the same host', () => {
	assert.equal(sameOriginLoopback({ host: '127.0.0.1:8765', origin: 'http://127.0.0.1:8765' }, true), true);
	assert.equal(sameOriginLoopback({ host: 'localhost:9000', origin: 'http://localhost:9000' }, true), true);
	assert.equal(sameOriginLoopback({ host: 'localhost:8765' }, false), true);
	// a WebSocket from the CRM always has an Origin
	assert.equal(sameOriginLoopback({ host: 'localhost:8765' }, true), false);
	// another website's page
	assert.equal(sameOriginLoopback({ host: '127.0.0.1:8765', origin: 'https://evil.example' }, true), false);
	assert.equal(sameOriginLoopback({ host: '127.0.0.1:8765', origin: 'http://127.0.0.1:8766' }, true), false);
	// DNS rebinding: an outside name pointed at loopback
	assert.equal(sameOriginLoopback({ host: 'evil.example:8765', origin: 'http://evil.example:8765' }, true), false);
	assert.equal(sameOriginLoopback({ origin: 'http://127.0.0.1:8765' }, true), false);
	assert.equal(sameOriginLoopback({ host: '127.0.0.1:8765', origin: 'null' }, true), false);
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check';
import { blogImages, images } from './images';
import { metrics } from './metrics';
import { photoTimes } from './photo-times';
import { prebuild } from './prebuild';
import { terrain } from './terrain';
import { translateBlog } from './translate-blog';
import { videoMeta } from './video-meta';

/**
 * Headless `pnpm crm <command>`: the deploy-time data steps, run without the UI.
 * bin.mjs loads this module through Vite (same aliases as the server) and exits with run()'s code.
 */

export type ParsedArgs = { command: string | null; flags: Set<string>; positional: string[] };

/** Where a command reports: one `change` line per changed file, `warn` for problems, `summary` at the end. */
export type Output = { change(path: string, what: string): void; warn(msg: string): void; summary(msg: string): void };

export type Command = {
	name: string;
	/** One line for `pnpm crm help`. */
	summary: string;
	/** Flags it takes, without the `--`; any other flag is refused (exit 2) before it runs. */
	flags?: readonly string[];
	/** 0 on success (nothing to do included), non-zero on a real failure. */
	run(root: string, args: ParsedArgs, out: Output): Promise<number>;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const COMMANDS: Command[] = [metrics, terrain, photoTimes, videoMeta, images, blogImages, translateBlog, check, prebuild];

/** `--name` becomes the flag `name`; the first other word is the command, the rest are positionals. */
export function parseArgs(argv: string[]): ParsedArgs {
	const flags = new Set<string>();
	const words: string[] = [];
	for (const a of argv) {
		if (a.startsWith('--') && a.length > 2) flags.add(a.slice(2));
		else words.push(a);
	}
	return { command: words[0] ?? null, flags, positional: words.slice(1) };
}

export const consoleOutput: Output = {
	change: (p, what) => console.log(`${p}: ${what}`),
	warn: (msg) => console.error(msg),
	summary: (msg) => console.log(msg)
};

function usage(): string {
	const width = Math.max(...COMMANDS.map((c) => c.name.length));
	return [
		'Usage: pnpm crm <command> [args] [--dry-run]   (--dry-run: every command but check)',
		'       pnpm crm [--port N]   (no command: start the UI)',
		'',
		'Commands:',
		...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
		`  ${'help'.padEnd(width)}  This list`
	].join('\n');
}

export async function run(argv: string[], root: string = REPO_ROOT, out: Output = consoleOutput): Promise<number> {
	const args = parseArgs(argv);
	if (args.command === 'help' || (args.command === null && args.flags.has('help'))) {
		out.summary(usage());
		return 0;
	}
	const cmd = COMMANDS.find((c) => c.name === args.command);
	if (!cmd) {
		out.warn(`Unknown command: ${args.command ?? '(none)'}\n\n${usage()}`);
		return 2;
	}
	if (args.flags.has('help')) {
		out.summary(`pnpm crm ${cmd.name}${(cmd.flags ?? []).map((f) => ` [--${f}]`).join('')}: ${cmd.summary}`);
		return 0;
	}
	const unknown = [...args.flags].filter((f) => !(cmd.flags ?? []).includes(f));
	if (unknown.length) {
		out.warn(`Unknown flag for ${cmd.name}: ${unknown.map((f) => '--' + f).join(', ')}\n\n${usage()}`);
		return 2;
	}
	try {
		return await cmd.run(root, args, out);
	} catch (e) {
		out.warn(`${cmd.name}: ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	}
}

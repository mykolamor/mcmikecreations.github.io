import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { check } from './check';
import { blogImages, images } from './images';
import { metrics } from './metrics';
import { photoTimes } from './photo-times';
import { terrain } from './terrain';
import { videoMeta } from './video-meta';
import type { Command, Output, ParsedArgs } from './index';
import { dryRunNote, plural } from './posts';

/** A command and the flags (without `--`) it runs with. */
export type Step = [Command, string[]];

/** Runs each step's command in order, in this process, with `--dry-run` passed to those that take it; stops at the first non-zero exit and returns it. */
export async function runSteps(root: string, args: ParsedArgs, out: Output, steps: Step[]): Promise<number> {
	const dryRun = args.flags.has('dry-run');
	for (const [cmd, flags] of steps) {
		const all = new Set(flags);
		if (dryRun && (cmd.flags ?? []).includes('dry-run')) all.add('dry-run');
		out.summary(`prebuild: ${cmd.name}${[...all].map((f) => ` --${f}`).join('')}`);
		let code: number;
		try {
			code = await cmd.run(root, { command: cmd.name, flags: all, positional: [] }, out);
		} catch (e) {
			out.warn(`${cmd.name}: ${e instanceof Error ? e.message : String(e)}`);
			code = 1;
		}
		if (code !== 0) {
			out.summary(`prebuild: ${cmd.name} failed (exit ${code}), later steps not run`);
			return code;
		}
	}
	out.summary(`prebuild: ${steps.length} steps done${dryRunNote(dryRun)}`);
	return 0;
}

/** The temp names the CRM's writers use under static/: `<file>.<pid>.tmp` (writeAllAtomic, the AVIF encoder, create) and a video upload's `.upload-<hex>.part`. */
const TEMP_TMP = /\.(\d+)\.tmp$/;
const TEMP_PART = /^\.upload-[0-9a-f]{12}\.part$/;
/** An upload's part file written to this recently may still be coming in (a UI running beside). */
const PART_IDLE_MS = 3600 * 1000;

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** Temp files a writer that died left under static/; not those of a live process or an upload still coming in. */
function staleTemps(dir: string, now: number, out: string[] = []): string[] {
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, d.name);
		if (d.isDirectory()) {
			staleTemps(p, now, out);
			continue;
		}
		if (!d.isFile()) continue;
		const pid = TEMP_TMP.exec(d.name)?.[1];
		if (pid ? !alive(Number(pid)) : TEMP_PART.test(d.name) && now - statSync(p).mtimeMs > PART_IDLE_MS) out.push(p);
	}
	return out;
}

/** Removes (under --dry-run only lists) the stale temp files under static/, one change line each; returns how many. */
export function removeStaleTemps(root: string, dryRun: boolean, out: Output): number {
	const dir = path.join(root, 'static');
	const files = existsSync(dir) ? staleTemps(dir, Date.now()).sort() : [];
	for (const f of files) {
		if (!dryRun) rmSync(f, { force: true });
		out.change(path.relative(root, f), `stale temp file, ${dryRun ? 'would remove' : 'removed'}`);
	}
	if (files.length) out.summary(`prebuild: ${plural(files.length, 'stale temp file')} ${dryRun ? 'to remove' : 'removed'}`);
	return files.length;
}

const STEPS: Step[] = [
	[metrics, ['missing-only']],
	[photoTimes, []],
	[terrain, []],
	[videoMeta, []],
	[images, []],
	[blogImages, []],
	[check, []]
];

/** The deploy's data step: stale temp files removed, then every headless command in the order the site build needs them. */
export const prebuild: Command & { steps: Step[] } = {
	name: 'prebuild',
	summary: "the deploy's data steps in order: metrics --missing-only, photo-times, terrain, video-meta, images, blog-images, check",
	flags: ['dry-run'],
	steps: STEPS,
	run(root, args, out) {
		if (args.positional.length) {
			out.warn(`prebuild takes no post names: ${args.positional.join(' ')}`);
			return Promise.resolve(2);
		}
		removeStaleTemps(root, args.flags.has('dry-run'), out);
		return runSteps(root, args, out, STEPS);
	}
};

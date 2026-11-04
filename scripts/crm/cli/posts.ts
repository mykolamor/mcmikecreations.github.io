import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoPaths } from '../server/paths';
import { isTranslationFile } from '../server/translations';
import type { Output } from './index';

/** What the commands share: which posts and docs they walk (a translation is never one), and how their summaries read. */

export const POST = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

/** The posts named on the command line (`<date>-<slug>` or a `.md` path), else every dated post. */
export function postFiles(root: string, names: string[]): string[] {
	const dir = repoPaths(root).markdown;
	if (!names.length) return readdirSync(dir).filter((f) => POST.test(f) && !isTranslationFile(f)).sort().map((f) => path.join(dir, f));
	return names.map((n) => (n.endsWith('.md') ? path.resolve(root, n) : path.join(dir, `${n}.md`)));
}

/** Every post, then every place doc (as the former scripts/matches/cliutil.py all_posts). */
export function docFiles(root: string): string[] {
	const p = repoPaths(root);
	const md = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && !isTranslationFile(f)).sort().map((f) => path.join(dir, f)) : []);
	return [...md(p.markdown), ...md(p.places)];
}

export type PostFile = { file: string; rel: string; date: string; slug: string };

/**
 * Runs `fn` on each of postFiles(root, names) in turn. A name that isn't a dated post in the markdown folder, or
 * isn't there, and anything `fn` throws, is reported as `<rel>: <message>` and the next post runs. Returns how many failed.
 */
export async function forEachPost(root: string, names: string[], out: Output, fn: (post: PostFile) => void | Promise<void>): Promise<number> {
	let failed = 0;
	for (const file of postFiles(root, names)) {
		const rel = path.relative(root, file);
		try {
			const m = POST.exec(path.basename(file));
			if (!m || isTranslationFile(path.basename(file)) || path.dirname(file) !== repoPaths(root).markdown) throw new Error('not a dated post in the markdown folder');
			if (!existsSync(file)) throw new Error('no such post');
			await fn({ file, rel, date: m[1], slug: m[2] });
		} catch (e) {
			out.warn(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
			failed++;
		}
	}
	return failed;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a summary line ends with under `--dry-run`. */
export const dryRunNote = (dryRun: boolean) => (dryRun ? ' (dry run, nothing written)' : '');

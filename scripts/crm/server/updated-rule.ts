// `updated:` stamping (spec "updated: is set automatically"): adding or removing a photo on a published post — its
// markdown file is in git's HEAD commit — sets `updated: <today>` at most once per day. Pins, captions, alt text and
// metadata fixes never call this; place docs are never stamped.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { setFrontmatterValue } from '../shared/ops';
import { writeAllAtomic } from './files';
import { repoPaths } from './paths';

export type StampResult = { stamped: true; previous: string | null } | { stamped: false };
export type StampOptions = { isTracked?: (root: string, file: string) => boolean; today?: () => string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date (YYYY-MM-DD) on the local calendar. */
export function localToday(now = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * True when `file` is in the HEAD commit of the repo at `root` (published). The index is not enough: the IDE stages
 * new files on its own. False for uncommitted files and when `root` is not a repo (or has no commits).
 */
export function gitPublished(root: string, file: string): boolean {
	const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
	if (rel.startsWith('../')) return false;
	try {
		execFileSync('git', ['cat-file', '-e', `HEAD:./${rel}`], { cwd: root, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

const plain = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined || v === null ? null : String(v));

/**
 * Sets `updated: <today>` in the post (a file name in the markdown folder, or a path) when it is committed and
 * `updated` is not already today. `previous` lets the client undo with `PATCH post.updated`.
 */
export async function maybeStampUpdated(root: string, postFile: string, opts: StampOptions = {}): Promise<StampResult> {
	const file = path.isAbsolute(postFile) ? postFile : path.join(repoPaths(root).markdown, postFile);
	// A place doc has no `updated:` (not in placeDoc.knownKeys); callers skip it, this is the backstop.
	if (path.dirname(path.resolve(file)) === path.resolve(repoPaths(root).places)) return { stamped: false };
	if (!(opts.isTracked ?? gitPublished)(root, file)) return { stamped: false };
	const today = (opts.today ?? (() => localToday()))();
	const raw = readFileSync(file, 'utf8');
	const { doc, body } = readFrontmatterDoc(raw);
	const previous = plain(doc.get('updated'));
	if (previous === today) return { stamped: false };
	setFrontmatterValue(doc, ['updated'], today);
	writeAllAtomic([[file, writeFrontmatterDoc(doc, body)]]);
	return { stamped: true, previous };
}

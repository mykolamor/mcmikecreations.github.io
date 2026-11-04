// Browses static/images for the Photos tab's Library dialog: folders and image hrefs, AVIF tiers and blur files folded
// into the base href that addFromLibrary takes.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { AVIF_TIERS } from '../../../src/lib/renderers/responsive-image';
import { ApiError } from './errors';
import { repoPaths } from './paths';

export type LibraryListing = { dir: string; folders: string[]; images: { href: string; w?: number; h?: number }[] };

const ORIGINAL = /\.(jpe?g|png|webp)$/i;
const TIER = new RegExp(`-(?:${AVIF_TIERS.join('|')})\\.avif$`, 'i');
const BLUR = /-blur\.[a-z0-9]+$/i;

/** `dir` is relative to static/images; `..`, absolute paths and backslashes answer 400, a missing folder 404. */
export function listLibrary(root: string, dir: string): LibraryListing {
	const raw = dir ?? '';
	if (raw.includes('\\') || raw.includes('\0') || path.posix.isAbsolute(raw) || /^[a-z]:/i.test(raw)) throw new ApiError(400, `Bad folder: ${raw}`);
	const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
	if (parts.includes('..')) throw new ApiError(400, `Bad folder: ${raw}`);
	const base = path.join(repoPaths(root).static, 'images');
	const abs = path.join(base, ...parts);
	if (abs !== base && !abs.startsWith(base + path.sep)) throw new ApiError(400, `Bad folder: ${raw}`);
	let isDir = false;
	try {
		isDir = statSync(abs).isDirectory();
	} catch {
		/* missing */
	}
	if (!isDir) throw new ApiError(404, `No such folder: ${raw}`);

	const rel = parts.join('/');
	const prefix = `/images/${rel ? `${rel}/` : ''}`;
	const folders: string[] = [];
	const originals = new Map<string, string>(); // stem → file name
	const tierStems = new Set<string>();
	for (const ent of readdirSync(abs, { withFileTypes: true })) {
		if (ent.name.startsWith('.')) continue;
		if (ent.isDirectory()) folders.push(ent.name);
		else if (!ent.isFile()) continue;
		else if (TIER.test(ent.name)) tierStems.add(ent.name.replace(TIER, ''));
		else if (BLUR.test(ent.name)) continue; // a blur file only accompanies an original or tiers listed anyway
		else if (ORIGINAL.test(ent.name)) originals.set(ent.name.replace(/\.[^.]+$/, ''), ent.name);
	}
	const names = new Set(originals.values());
	// Tier-only photos (originals not kept): the href is `<stem>.jpg`, as story keys are.
	for (const stem of tierStems) if (!originals.has(stem)) names.add(`${stem}.jpg`);
	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	return { dir: rel, folders: folders.sort(cmp), images: [...names].sort(cmp).map((n) => ({ href: prefix + n })) };
}

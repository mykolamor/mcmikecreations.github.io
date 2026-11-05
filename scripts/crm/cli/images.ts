import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMap, type YAMLMap } from 'yaml';
import { keyFor, ownFolderOf } from '../lib/image-key';
import { encodeTiersTo, localImageRefs } from '../lib/images';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { writeAllAtomic } from '../server/files';
import { putScalar } from '../server/photo-ops';
import { imageMetaFor } from '../../../src/lib/renderers/image-meta';
import { avifTiers, avifVariantHref, type HikeImageMeta } from '../../../src/lib/renderers/responsive-image';
import { isTranslationFile, translationBodies } from '../server/translations';
import type { Command, Output } from './index';
import { docFiles, dryRunNote, plural } from './posts';

const FIELDS = ['w', 'h', 'blur'] as const;

/** The tier targets of `href` not on disk; none can be known before the size is. */
function missingTiers(root: string, href: string, meta: HikeImageMeta | undefined): number[] {
	if (!meta?.w || !meta?.h) return [];
	return avifTiers(meta.w, meta.h).filter((t) => !existsSync(path.join(root, 'static', avifVariantHref(href, t.target)))).map((t) => t.target);
}

/** What updateDocImages found for one doc: one `<key> <fields>` line per image brought up to date, and the sources missing. */
type DocResult = { what: string[]; missing: number };

/**
 * Gives every href in `refs` its AVIF tiers and `w`, `h` and `blur` in the doc's `images` map, where missing, and
 * writes the doc back when it changed (not under `dryRun`). `keyOf` names a new entry; an existing entry under the
 * full href or the bare file name is the one updated.
 */
async function updateDocImages(
	root: string,
	file: string,
	refs: Iterable<string>,
	keyOf: (href: string) => string,
	dryRun: boolean,
	out: Output
): Promise<DocResult> {
	const rel = path.relative(root, file);
	const raw = readFileSync(file, 'utf8');
	const { doc, body } = readFrontmatterDoc(raw);
	const all = ((doc.toJS() ?? {}) as { images?: Record<string, HikeImageMeta> }).images ?? {};
	const what: string[] = [];
	let missing = 0;
	for (const href of refs) {
		const meta = imageMetaFor(all, href);
		const fields = FIELDS.filter((k) => meta?.[k] === undefined || meta?.[k] === null || meta?.[k] === '');
		const tiers = missingTiers(root, href, meta);
		if (!fields.length && !tiers.length) continue;
		// Photos added in the Photos tab keep only their tiers; the original is needed only to make what is missing.
		const src = path.join(root, 'static', href);
		if (!existsSync(src)) {
			out.warn(`${rel}: missing source ${href}`);
			missing++;
			continue;
		}
		const key = Object.hasOwn(all, href) ? href : meta ? path.basename(href) : keyOf(href);
		if (!dryRun) {
			const r = await encodeTiersTo(src, href, root, { skipExisting: true });
			let map = doc.get('images', true) as YAMLMap | undefined;
			if (!isMap(map)) {
				doc.set('images', doc.createNode({}));
				map = doc.get('images', true) as YAMLMap;
			}
			const found = map.get(key, true);
			const entry = isMap(found) ? found : (doc.createNode({}) as YAMLMap);
			if (!isMap(found)) {
				entry.flow = true;
				map.set(key, entry);
			}
			for (const k of fields) putScalar(entry, k, r[k]);
		}
		const parts: string[] = [...fields];
		if (tiers.length) parts.push(`tiers ${tiers.join(',')}`);
		else if (!meta?.w || !meta?.h) parts.push('tiers');
		what.push(`${key} ${parts.join(', ')}`);
	}
	if (what.length && !dryRun) {
		const text = writeFrontmatterDoc(doc, body);
		if (text !== raw) writeAllAtomic([[file, text]]);
	}
	return { what, missing };
}

/** Runs `refsOf` + updateDocImages over `files`, one change line per updated doc, and prints the summary. */
async function runImages(
	name: string,
	root: string,
	files: string[],
	refsOf: (file: string, body: string, front: Record<string, unknown>) => string[],
	keyOf: (file: string) => (href: string) => string,
	dryRun: boolean,
	out: Output
): Promise<number> {
	let docs = 0;
	let encoded = 0;
	let missing = 0;
	let failed = 0;
	for (const file of files) {
		const rel = path.relative(root, file);
		try {
			const { doc, body } = readFrontmatterDoc(readFileSync(file, 'utf8'));
			const front = (doc.toJS() ?? {}) as Record<string, unknown>;
			const r = await updateDocImages(root, file, refsOf(file, body, front), keyOf(file), dryRun, out);
			missing += r.missing;
			if (!r.what.length) continue;
			out.change(rel, r.what.join('; '));
			encoded += r.what.length;
			docs++;
		} catch (e) {
			out.warn(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
			failed++;
		}
	}
	const parts = [`${plural(encoded, 'image')} in ${plural(docs, 'doc')} ${dryRun ? 'to update' : 'updated'}`];
	if (missing) parts.push(`${plural(missing, 'missing source')}`);
	if (failed) parts.push(`${failed} failed`);
	out.summary(`${name}: ${parts.join(', ')}${dryRunNote(dryRun)}`);
	return failed ? 1 : 0;
}

/**
 * Brings every local image a post or place doc shows up to the standard: AVIF tiers next to it, and `w`, `h` and
 * `blur` in its `images` entry (the former oneoff/avif-backfill.ts). Only what is missing is added: existing tiers
 * are never re-encoded and existing fields keep their values. An image whose original is gone (the Photos tab
 * stores only tiers) is fine when nothing is missing, else listed as a missing source; it never fails. A new entry is keyed by the bare file name when the
 * image sits in the doc's own folder, else by its full href; an existing entry under either key is the one updated.
 */
export const images: Command = {
	name: 'images',
	summary: 'AVIF tiers, w, h and blur for every local image a post or place doc shows, where missing',
	flags: ['dry-run'],
	async run(root, args, out) {
		if (args.positional.length) {
			out.warn(`images takes no post names: ${args.positional.join(' ')}`);
			return 2;
		}
		return runImages(
			'images',
			root,
			docFiles(root),
			// A translation shows photos too, described by this doc's `images`.
			(file, body) => [...new Set([body, ...translationBodies(file)].flatMap(localImageRefs))],
			(file) => (href) => keyFor(href, ownFolderOf(path.basename(file))),
			args.flags.has('dry-run'),
			out
		);
	}
};

/** Where blog posts live, relative to the repo root. */
export const BLOG_DIR = 'static/_blog';

/** Raster images under /images/ only: an SVG or GIF stays as it is, with no tiers and no blur. */
const RASTER_HREF = /^\/images\/[^\s]+\.(?:jpe?g|png|webp)$/i;

/** The blog posts (translations excluded), sorted. */
export function blogFiles(root: string): string[] {
	const dir = path.join(root, BLOG_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.md') && !isTranslationFile(f))
		.sort()
		.map((f) => path.join(dir, f));
}

/** A blog post's local raster images: the `image` / `imageFull` front matter, then the body's (and its translations'). */
export function blogImageRefs(file: string, body: string, front: Record<string, unknown>): string[] {
	const heroes = [front.image, front.imageFull].filter((v): v is string => typeof v === 'string' && RASTER_HREF.test(v.trim())).map((v) => v.trim());
	return [...new Set([...heroes, ...[body, ...translationBodies(file)].flatMap(localImageRefs)])];
}

/**
 * The `images` step for blog posts (`static/_blog/*.md`): AVIF tiers next to each local raster image the post shows
 * (`image`, `imageFull` and the body), and `w`, `h` and `blur` in its `images` entry, keyed by the full href. Same
 * rules as `images`: only what is missing is added, so a second run changes nothing. A tier already on disk (a hike
 * photo a post borrows) is reused.
 */
export const blogImages: Command = {
	name: 'blog-images',
	summary: 'AVIF tiers, w, h and blur for every local raster image a blog post shows, where missing',
	flags: ['dry-run'],
	async run(root, args, out) {
		if (args.positional.length) {
			out.warn(`blog-images takes no post names: ${args.positional.join(' ')}`);
			return 2;
		}
		return runImages('blog-images', root, blogFiles(root), blogImageRefs, () => (href) => href, args.flags.has('dry-run'), out);
	}
};

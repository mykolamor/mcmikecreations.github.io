import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMap, type YAMLMap } from 'yaml';
import { keyFor, ownFolderOf } from '../lib/image-key';
import { encodeTiersTo, localImageRefs } from '../lib/images';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { writeAllAtomic } from '../server/files';
import { putScalar } from '../server/photo-ops';
import { imageMetaFor } from '../../../src/lib/renderers/image-meta';
import { avifTiers, avifVariantHref, type HikeImageMeta } from '../../../src/lib/renderers/responsive-image';
import { translationBodies } from '../server/translations';
import type { Command } from './index';
import { docFiles, dryRunNote, plural } from './posts';

const FIELDS = ['w', 'h', 'blur'] as const;

/** The tier targets of `href` not on disk; none can be known before the size is. */
function missingTiers(root: string, href: string, meta: HikeImageMeta | undefined): number[] {
	if (!meta?.w || !meta?.h) return [];
	return avifTiers(meta.w, meta.h).filter((t) => !existsSync(path.join(root, 'static', avifVariantHref(href, t.target)))).map((t) => t.target);
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
		const dryRun = args.flags.has('dry-run');
		let docs = 0;
		let encoded = 0;
		let missing = 0;
		let failed = 0;
		for (const file of docFiles(root)) {
			const rel = path.relative(root, file);
			try {
				const raw = readFileSync(file, 'utf8');
				const { doc, body } = readFrontmatterDoc(raw);
				const all = ((doc.toJS() ?? {}) as { images?: Record<string, HikeImageMeta> }).images ?? {};
				const what: string[] = [];
				// A translation shows photos too, described by this doc's `images`.
				const refs = new Set([body, ...translationBodies(file)].flatMap(localImageRefs));
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
					const key = Object.hasOwn(all, href) ? href : meta ? path.basename(href) : keyFor(href, ownFolderOf(path.basename(file)));
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
					encoded++;
				}
				if (!what.length) continue;
				if (!dryRun) {
					const text = writeFrontmatterDoc(doc, body);
					if (text !== raw) writeAllAtomic([[file, text]]);
				}
				out.change(rel, what.join('; '));
				docs++;
			} catch (e) {
				out.warn(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
				failed++;
			}
		}
		const parts = [`${plural(encoded, 'image')} in ${plural(docs, 'doc')} ${dryRun ? 'to update' : 'updated'}`];
		if (missing) parts.push(`${plural(missing, 'missing source')}`);
		if (failed) parts.push(`${failed} failed`);
		out.summary(`images: ${parts.join(', ')}${dryRunNote(dryRun)}`);
		return failed ? 1 : 0;
	}
};

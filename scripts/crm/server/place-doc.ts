import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document } from 'yaml';
import { STRINGIFY_OPTIONS, readFrontmatterDoc } from '../lib/frontmatter';
import { ApiError } from './errors';
import { plain, versionOf, writeAtomic } from './doc';
import { PLACE_SLUG, assertPlaceSlug, placePath } from './doc-ref';
import { repoPaths } from './paths';
import { PLACE_FIELDS } from '../shared/fields';
import { applyPlaceOps, type FieldOp } from '../shared/ops';

/** A place doc as on disk: `static/_projects/data-viz/hikes/places/<slug>.md`. */
export type PlaceDoc = { slug: string; raw: string; version: string };

/** What the browser sees for a place doc (no sidecar, mirrors or files). */
export type PlaceClientDoc = { kind: 'place'; slug: string; version: string; fields: Record<string, unknown>; body: string };


export function loadPlace(root: string, slug: string): PlaceDoc {
	assertPlaceSlug(slug);
	const file = placePath(root, slug);
	if (!existsSync(file)) throw new ApiError(404, `No place doc ${slug}`);
	const raw = readFileSync(file, 'utf8');
	return { slug, raw, version: versionOf(raw) };
}

export function placeClientDoc(doc: PlaceDoc): PlaceClientDoc {
	const { doc: fm, body } = readFrontmatterDoc(doc.raw);
	const fields: Record<string, unknown> = {};
	for (const decl of PLACE_FIELDS) {
		const js = (fm.getIn(decl.path, true) as any)?.toJS?.(fm);
		if (js !== undefined && js !== null) fields[decl.id] = Array.isArray(js) ? js.map(plain) : plain(js);
	}
	return { kind: 'place', slug: doc.slug, version: doc.version, fields, body };
}

export type PlaceSaveResult = { ok: boolean; doc: PlaceClientDoc };

/** Applies `ops` if `base` is still the on-disk version; writes only when the text changed. */
export function savePlaceOps(root: string, slug: string, base: string, ops: FieldOp[]): PlaceSaveResult {
	const cur = loadPlace(root, slug);
	if (cur.version !== base) return { ok: false, doc: placeClientDoc(cur) };
	const raw = applyPlaceOps(cur.raw, ops);
	if (raw !== cur.raw) writeAtomic(placePath(root, slug), raw);
	return { ok: true, doc: placeClientDoc({ slug, raw, version: versionOf(raw) }) };
}

/** A new place doc with its title and description (the site requires both); 409 when the file exists. */
export function createPlace(root: string, slug: string, title: string, description: string): { slug: string } {
	assertPlaceSlug(slug);
	if (typeof title !== 'string' || !title.trim()) throw new ApiError(400, 'A place doc needs a title');
	if (typeof description !== 'string' || !description.trim()) throw new ApiError(400, 'A place doc needs a description');
	const file = placePath(root, slug);
	if (existsSync(file)) throw new ApiError(409, `Place doc ${slug} already exists`);
	mkdirSync(repoPaths(root).places, { recursive: true });
	// Via yaml so a value like `Hut: upper` is quoted; a plain one is written as is.
	const yaml = new Document({ title: title.trim(), description: description.trim() }).toString(STRINGIFY_OPTIONS);
	writeFileSync(file, `---\n${yaml}---\n`, { flag: 'wx' });
	return { slug };
}

/** Every place doc with its title (the slug when the title can't be read), sorted by title. */
export function listPlaces(root: string): { slug: string; title: string }[] {
	const dir = repoPaths(root).places;
	const out: { slug: string; title: string }[] = [];
	for (const f of existsSync(dir) ? readdirSync(dir) : []) {
		const slug = f.slice(0, -3);
		if (!f.endsWith('.md') || !PLACE_SLUG.test(slug)) continue;
		let title = slug;
		try {
			const t = readFrontmatterDoc(readFileSync(path.join(dir, f), 'utf8')).doc.get('title');
			if (typeof t === 'string' && t.trim()) title = t;
		} catch {
			/* unreadable place doc: keep the slug as title */
		}
		out.push({ slug, title });
	}
	return out.sort((a, b) => a.title.localeCompare(b.title));
}

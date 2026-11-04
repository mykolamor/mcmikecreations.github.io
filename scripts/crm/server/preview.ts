// The Preview tab: a post or place doc rendered by the site's own renderer (parseMarkdown), with the options the post
// page loader (src/routes/hikes/[slug]/+page.server.ts) builds, but from the files as they are on disk now: the site's
// `storeNodes()`, `osmStore` and place-doc glob keep what they loaded first. No photo stops and no maps.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { parseMarkdown } from '../../../src/lib/hikes/hikes-info';
import { resolveRef } from '../../../src/lib/data/osm-store.js';
import { formatPhoneTags } from '../../../src/lib/data/osm-phone';
import { resolvePinNodes } from '../../../src/lib/hikes/photo-pins';
import { parsePlaceDoc, readPostPlaces, type PlaceDoc } from '../../../src/lib/hikes/place-docs.server';
import { placeDocAnchor } from '../../../src/lib/hikes/place-docs';
import type { PlaceNode } from '../../../src/lib/hikes/place-links';
import type { OsmEntry } from '../../../src/lib/data/map-info';
import { loadDoc } from './doc';
import type { EnglishRef } from './doc-ref';
import { isNum, mapView, originOf } from './map-data';
import { loadPlace } from './place-doc';
import { repoPaths } from './paths';

type Store = Record<string, OsmEntry>;

export type RenderInputs = {
	/** `osm.json` as read now. */
	store: Store;
	/** Every element of the store, resolved like the site's `storeNodes()` (local tags over OSM's, phones formatted). */
	nodes: PlaceNode[];
	origin: { lat: number; lon: number } | null;
	height: number | null;
	/** The hike's own nodes, those in the store. */
	ownRefs: string[];
	/** The post's place docs (its `places:`, else the sidecar's), read now; empty for a place doc. */
	placeDocs: PlaceDoc[];
	/** The post's (or place doc's) front matter; null for a hike without a post, or when it can't be read. */
	front: Record<string, unknown> | null;
	/** The post's (or place doc's) whole file; null for a hike without a post. */
	raw: string | null;
};

/**
 * What the renderer is given for this doc, as the post page loader builds it: every element of `osm.json`, the merged
 * origin and height, the hike's own nodes and the post's place docs. A place doc has no origin, height, own nodes or
 * place docs. A `places:` slug with no doc (Problems lists it; the site build fails) links no doc here, and front
 * matter that can't be read (a CRLF file, broken YAML) links none: the nodes still serve Write's suggestions.
 */
export function renderInputs(root: string, ref: EnglishRef): RenderInputs {
	const p = repoPaths(root);
	const store: Store = existsSync(p.osmStore) ? JSON.parse(readFileSync(p.osmStore, 'utf8')) : {};
	const nodes: PlaceNode[] = Object.keys(store)
		.filter((r) => isNum(store[r]?.lat) && isNum(store[r]?.lon))
		.map((r) => resolveRef(r, store, 'osm.json', { formatTags: formatPhoneTags }));
	if (ref.kind === 'place') {
		const raw = loadPlace(root, ref.slug).raw;
		return { store, nodes, origin: null, height: null, ownRefs: [], placeDocs: [], front: frontOf(raw), raw };
	}
	const date = ref.kind === 'post' ? ref.date : null;
	const doc = loadDoc(root, ref.slug, date);
	const front = doc.postRaw === null ? null : frontOf(doc.postRaw);
	// Unreadable front matter overrides nothing: the sidecar's origin, height and nodes.
	const view = mapView(doc.postRaw !== null && front === null ? { ...doc, postRaw: null } : doc);
	const docs = new Map<string, PlaceDoc>();
	for (const f of existsSync(p.places) ? readdirSync(p.places) : []) {
		if (!f.endsWith('.md')) continue;
		try {
			const d = parsePlaceDoc(f, readFileSync(path.join(p.places, f), 'utf8'));
			docs.set(d.slug, d);
		} catch {
			/* a malformed doc fails the site build; here it just isn't linked */
		}
	}
	let placeDocs: PlaceDoc[] = [];
	// Unreadable front matter: whether its `places:` overrides the sidecar's is unknown, so no docs.
	if (doc.postRaw === null || front !== null) {
		try {
			const sidecar = JSON.parse(doc.sidecarRaw);
			placeDocs = readPostPlaces(front, `${date}-${ref.slug}.md`, docs, { places: sidecar?.places, source: `${ref.slug}.hike.json` });
		} catch {
			/* an unknown slug in `places:` fails the site build (Problems lists it); here nothing is linked to a doc */
		}
	}
	const height = view.height.value;
	// The hike's own nodes, those in the store (as the Map tab draws them).
	const ownRefs = view.refs.filter((r) => isNum(store[r]?.lat) && isNum(store[r]?.lon));
	return { store, nodes, origin: originOf(view.origin.value), height: isNum(height) ? height : null, ownRefs, placeDocs, front, raw: doc.postRaw };
}

/** The front matter as plain data; null when it can't be read (the doc routes answer 422 for it). */
function frontOf(raw: string): Record<string, unknown> | null {
	try {
		return readFrontmatterDoc(raw).doc.toJS() ?? {};
	} catch {
		return null;
	}
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A place doc's section, as the post page's "Places on this route" shows it (open, since nothing here can open it). */
function placeSection(doc: { slug: string; title: string; description: string; tags: string[] }, html: string): string {
	const tags = doc.tags.length ? `<div class="place-tags">${doc.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : '';
	return (
		`<details id="${esc(placeDocAnchor(doc.slug))}" class="place" open>` +
		`<summary><span class="place-title" translate="no">${esc(doc.title)}</span><span class="place-description">${esc(doc.description)}</span></summary>` +
		`${tags}<div>${html}</div></details>`
	);
}

/**
 * The doc as the site would show it. A post: its body (with the renderer's style block), then its place docs, each
 * rendered as the loader renders them (no widgets or styles, media indices continuing). A place doc: its body like a
 * post's place section, with the style block. A hike without a post has nothing to render (404).
 */
export async function previewHtml(root: string, ref: EnglishRef): Promise<{ html: string }> {
	const { store, nodes, origin, height, ownRefs, placeDocs, front, raw } = renderInputs(root, ref);
	if (raw === null) return { html: '' };
	// Unreadable front matter: the reason, as the doc routes give it (422).
	if (front === null) readFrontmatterDoc(raw);
	const warn = (message: string) => console.warn(message);
	if (ref.kind === 'place') {
		const pinNodes = resolvePinNodes([{ data: front, source: `places/${ref.slug}.md` }], store, warn, { formatTags: formatPhoneTags });
		const { html } = await parseMarkdown(raw, [], { nodes, widgets: false, styles: true, pinNodes });
		const doc = parsePlaceDoc(`${ref.slug}.md`, raw);
		return { html: `<section data-place-docs>${placeSection(doc, html)}</section>` };
	}
	const pinNodes = resolvePinNodes(
		[{ data: front, source: `${ref.kind === 'post' ? ref.date : ''}-${ref.slug}.md` }, ...placeDocs.map((doc) => ({ data: readFrontmatterDoc(doc.raw).doc.toJS() ?? {}, source: `places/${doc.slug}.md` }))],
		store,
		warn,
		{ formatTags: formatPhoneTags }
	);
	const tags = Array.isArray(front?.tags) ? (front.tags as string[]) : [];
	const placeRefs = placeDocs.map(({ slug, title, names }) => ({ slug, title, names }));
	const parsed = await parseMarkdown(raw, tags, { nodes, origin, height, ownRefs, placeDocs: placeRefs, pinNodes });
	let html = parsed.html;
	if (placeDocs.length) {
		let mediaOffset = parsed.media.length;
		html += '<section data-place-docs><h2>Places on this route</h2>';
		for (const doc of placeDocs) {
			const rendered = await parseMarkdown(doc.raw, [], { nodes, origin, height, ownRefs, mediaOffset, widgets: false, styles: false, pinNodes });
			html += placeSection(doc, rendered.html);
			mediaOffset += rendered.media.length;
		}
		html += '</section>';
	}
	return { html };
}

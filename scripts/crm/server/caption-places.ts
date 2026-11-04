// Places a photo caption names, found with the site's place matcher (src/lib/hikes/place-links): `Name (1234 m)`
// references, and plain whole names of store elements. The pin editor lists the ones not pinned yet.
import { existsSync } from 'node:fs';
import { LEADING_ENGLISH, TOPONYM } from '../../../src/lib/hikes/hikes-info';
import { buildPlaceIndex, type PlaceIndexOptions, type PlaceNode } from '../../../src/lib/hikes/place-links';
import { readStore } from '../lib/osm-store-file';
import type { EnglishRef } from './doc-ref';
import { mapPayload } from './map-data';
import { effectiveTags } from './osm-service';
import { repoPaths } from './paths';

export type NamedPlace = { ref: string; name: string | null; lat: number; lon: number };
type RefNode = PlaceNode & { ref: string };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
/** Longest plain mention tried, in words. */
const MAX_WORDS = 4;

/** The places `caption` names, in the order they first appear, each once. */
export function captionPlaces(caption: string, nodes: RefNode[], options: PlaceIndexOptions = {}): NamedPlace[] {
	const index = buildPlaceIndex(nodes, options);
	if (!index || !caption) return [];
	// Link text stays, link targets go: `by [Name](https://…)` names Name, never a word of the URL.
	const text = caption.replace(/!?\[([^\]]*)\]\([^)]*\)/g, (m, inner: string) => inner + ' '.repeat(m.length - inner.length));
	const hits: { at: number; node: RefNode }[] = [];
	for (const m of text.matchAll(TOPONYM)) {
		const words = m[0].split(/\s+/);
		const eleAt = words.findIndex((w) => w.startsWith('('));
		let start = 0;
		while (start + 1 < eleAt && LEADING_ENGLISH.has(words[start])) start++;
		const ele = Number(/\d+(?:[.,]\d+)?/.exec(m[0].slice(m[0].lastIndexOf('(')))?.[0].replace(',', '.'));
		const hit = index.match(words.slice(start, eleAt), ele);
		if (hit) hits.push({ at: m.index!, node: hit.node as RefNode });
	}
	const words = [...text.matchAll(WORD)].map((m) => ({ w: m[0].replace(/['’-]+$/, ''), at: m.index! }));
	for (let e = 0; e < words.length; e++) {
		const from = Math.max(0, e - MAX_WORDS + 1);
		// No elevation to check a partial name against: only whole names count, as for mentions on the site.
		const hit = index.match(words.slice(from, e + 1).map((x) => x.w), NaN);
		const first = hit ? words[from + hit.start] : null;
		if (hit && first && /^\p{Lu}/u.test(first.w)) hits.push({ at: first.at, node: hit.node as RefNode });
	}
	const seen = new Set<string>();
	return hits
		.sort((a, b) => a.at - b.at)
		.filter((h) => !seen.has(h.node.ref) && !!seen.add(h.node.ref))
		.map(({ node }) => ({ ref: node.ref, name: typeof node.tags?.name === 'string' ? node.tags.name : null, lat: node.lat, lon: node.lon }));
}

/**
 * The places a caption of this doc's photo names: the whole store, same-name elements decided by nearness to the
 * hike's origin as on the site (a place doc has no origin). Unlike prose links there is no cut to the map's tile
 * square: a photo can show (and pin) a peak far off the map.
 */
export function postCaptionPlaces(root: string, ref: EnglishRef, caption: string): NamedPlace[] {
	const file = repoPaths(root).osmStore;
	const store = existsSync(file) ? readStore(file) : {};
	const nodes: RefNode[] = [];
	for (const [ref, e] of Object.entries(store)) if (typeof e.lat === 'number' && typeof e.lon === 'number') nodes.push({ ref, lat: e.lat, lon: e.lon, tags: effectiveTags(e) });
	if (ref.kind === 'place') return captionPlaces(caption, nodes);
	const map = mapPayload(root, ref.slug, ref.kind === 'post' ? ref.date : null);
	return captionPlaces(caption, nodes, { origin: map.origin });
}

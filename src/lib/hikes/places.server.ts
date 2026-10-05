/**
 * Server-only: every place doc in `static/_projects/data-viz/hikes/places/`,
 * read once at build time, and the ones a post lists under `places:`.
 * Parsing and checking live in `place-docs.server.ts`.
 */

import { parsePlaceDoc, readPostPlaces, type PlaceDoc } from '$lib/hikes/place-docs.server';

const PLACES_FOLDER = '/static/_projects/data-viz/hikes/places/';

const rawPlaces = import.meta.glob('/static/_projects/data-viz/hikes/places/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

const placesBySlug = new Map<string, PlaceDoc>();
for (const [key, raw] of Object.entries(rawPlaces)) {
	const doc = parsePlaceDoc(key.substring(PLACES_FOLDER.length), raw);
	placesBySlug.set(doc.slug, doc);
}

/** Every place doc, by slug. */
export function allPlaceDocs(): ReadonlyMap<string, PlaceDoc> {
	return placesBySlug;
}

/**
 * The place docs a post lists, in order: its front matter's `places:`, else its
 * sidecar's. Throws on an unknown slug.
 */
export function placeDocsForPost(
	frontmatter: Record<string, unknown> | null | undefined,
	postSource: string,
	sidecar?: { places?: unknown; source: string }
): PlaceDoc[] {
	return readPostPlaces(frontmatter, postSource, placesBySlug, sidecar);
}

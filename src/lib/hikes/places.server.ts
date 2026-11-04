/**
 * Server-only: every place doc in `static/_projects/data-viz/hikes/places/`,
 * read once at build time, and the ones a post lists under `places:`.
 * Parsing and checking live in `place-docs.server.ts`; the folder's
 * translations are split off to `translations.server.ts`.
 */

import { parsePlaceDoc, readPostPlaces, type PlaceDoc } from '$lib/hikes/place-docs.server';
import { collectTranslations, splitTranslations } from '$lib/hikes/translations.server';

const PLACES_FOLDER = '/static/_projects/data-viz/hikes/places/';

const rawPlaces = import.meta.glob('/static/_projects/data-viz/hikes/places/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

// The folder's translations (`<slug>.<lang>.md`) are split off: they are not place docs.
const { docs: placeFiles, translations: placeTranslationFiles } = splitTranslations(
	Object.fromEntries(Object.entries(rawPlaces).map(([key, raw]) => [key.substring(PLACES_FOLDER.length), raw]))
);

const placesBySlug = new Map<string, PlaceDoc>();
for (const [file, raw] of Object.entries(placeFiles)) {
	const doc = parsePlaceDoc(file, raw);
	placesBySlug.set(doc.slug, doc);
}

/** The place docs' translations, by source file; `allTranslations` (`hikes.server.ts`) serves them with the posts'. */
export const placeTranslations = collectTranslations('place', placeTranslationFiles, new Set(Object.keys(placeFiles)));

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

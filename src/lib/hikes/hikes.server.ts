/**
 * The hike database, assembled at build time from three sources:
 *
 *  - `<slug>.hike.json` sidecars — one per hike: the hand-authored map fields,
 *    and the definitive list of which hikes exist.
 *  - `<date>-<slug>.md` posts — one per blogged date. The filename supplies the
 *    date and the route; the front matter supplies that date's own fields.
 *  - `hikes.json` — only what neither of those can say: dates with no post yet,
 *    `draft` / `hidden`, metric fallbacks for those dates, and the rare path
 *    that breaks convention.
 *
 * A blogged date therefore needs no entry in `hikes.json` at all, which is why
 * only the hikes still missing a post are left in it.
 *
 * Server-only: it globs markdown, which must not reach the client bundle.
 * Browser code reads the prerendered `/hikes/index.json` instead.
 */

import routes from '$lib/data/hikes.json';
import { getHikeMeta, hasGpxFile, hikeSlugs } from '$lib/data/hikes-db';
import { assembleHikes, metaFolder, resolveHikeForPost as resolveWith } from '$lib/data/hikes-core';
import type { Map, MapDate, MapProperties } from '$lib/data/map-info';
import { readHikeFrontmatter } from '$lib/hikes/frontmatter.server';
import { placeTranslations } from '$lib/hikes/places.server';
import {
	collectTranslations,
	mergeTranslations,
	splitTranslations,
	type TranslationsBySource
} from '$lib/hikes/translations.server';

type Dict = Record<string, unknown>;

/** `hikes.json` carries only overrides, so it is not a `Map` on its own. */
const overrides = routes as unknown as Array<{ route: string; properties: Partial<MapProperties> }>;

// Raw markdown for every hike post, keyed by glob path, inlined into the bundle.
const rawFiles = import.meta.glob('/static/_projects/data-viz/hikes/markdown/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

// The folder's translations (`<date>-<slug>.<lang>.md`) are split off: they are not posts.
const { docs: postFiles, translations: postTranslationFiles } = splitTranslations(
	Object.fromEntries(Object.entries(rawFiles).map(([key, raw]) => [key.substring(key.lastIndexOf('/') + 1), raw]))
);

const posts = Object.entries(postFiles).map(([file, raw]) => ({
	file,
	path: `${metaFolder}/${file}`,
	frontmatter: readHikeFrontmatter(raw).data
}));

const translations = mergeTranslations({
	posts: collectTranslations('post', postTranslationFiles, new Set(Object.keys(postFiles))),
	places: placeTranslations
});

const frontmatterByPath: Record<string, Dict> = Object.fromEntries(
	posts.map((p) => [p.path, p.frontmatter])
);

/**
 * Every hike, newest first by its most recent date — the order the rest of the
 * site presents them in. `hikes.json`'s own order no longer means anything, as
 * most hikes are not in it. Assembled by `hikes-core`, shared with the Node
 * scripts.
 */
export const hikes: Map[] = assembleHikes({
	slugs: hikeSlugs,
	posts,
	overrides,
	getHikeMeta,
	hasGpxFile
});

/** A post's parsed front matter, or undefined for a date with no markdown. */
export function getPostFrontmatter(path: string | null | undefined): Dict | undefined {
	return path ? frontmatterByPath[path] : undefined;
}

/**
 * The hike as one of its dates sees it, front matter included — the same
 * resolution the post page performs.
 *
 * Date-level fields are already folded into the model, so this exists for the
 * hike-level front-matter keys (`name`, `height`, `origin`, `draft`, `hidden`,
 * `checkpoints`, `nodes`) and for promoting `filePath` / metrics into
 * `properties`. Read metrics and geometry from the returned `properties`.
 */
export function resolveHikeForPost(hike: Map, date: MapDate): { hike: Map; properties: MapProperties } {
	return resolveWith(hike, date, getPostFrontmatter(date.path), getHikeMeta);
}

/**
 * Every translation, the posts' and the place docs', by the English file it
 * translates, then language: a post's by its file name (`2026-07-19-x.md`), a
 * place doc's by folder and file name (`places/knorrhuette.md`). Checked at
 * build: each has its source, and the media its body shows exist.
 */
export function allTranslations(): TranslationsBySource {
	return translations;
}

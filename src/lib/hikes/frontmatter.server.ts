/**
 * Server-only front matter parsing + override merging.
 *
 * Front matter is flat: one key per field, no nested `properties` / `dates` /
 * `standardFeatures` blocks. Each key is routed to the level that owns the field
 * (see the key sets in `hikes-core`, shared with the Node scripts), which is
 * why the merge is an explicit mapping rather than a spread.
 *
 * Override rule: a value written in a post's front matter wins over the matching
 * field from the hike database (`hikes-db`), but only when it is present and not
 * null. Anything omitted (or explicitly null) falls back to the database value,
 * so posts without front matter behave exactly as they did before — and no key
 * can clear a value back to null.
 */

import matter from 'gray-matter';
import { getHikeMeta } from '$lib/data/hikes-db';
import {
	applyPostOverrides as applyWith,
	readDateFields,
	readMetaPathOverride
} from '$lib/data/hikes-core';
import type { Map, MapDate, MapProperties } from '$lib/data/map-info';

export { readDateFields, readMetaPathOverride };

/*
 * Keys with no override slot at all:
 *  - `route`, and a date's `date` / `path` — identity. Overriding them would
 *    desync the slug or the already-fetched markdown.
 *  - `origin` is handled on its own in `applyPostOverrides`, since it nests inside
 *    `standardFeatures`.
 *  - `contacts` has its own reader, `readHikeContacts`, and is display-only.
 *  - `facts` has its own reader, `readHikeFacts` (`facts.server.ts`).
 *  - `places` (the post's place docs) has its own reader, `placeDocsForPost`
 *    (`places.server.ts`).
 * Anything else is ignored rather than spread onto the hike, so a typo cannot
 * quietly enter the page payload.
 */

type Dict = Record<string, unknown>;

/**
 * Parse a hike markdown file, returning the raw front matter data and the body
 * with the front matter removed. Never throws: malformed YAML logs and yields an
 * empty object with the original text as the body.
 */
export function readHikeFrontmatter(raw: string): { data: Dict; content: string } {
	try {
		const parsed = matter(raw);
		return { data: (parsed.data ?? {}) as Dict, content: parsed.content };
	} catch (ex) {
		console.log('Failed to parse hike front matter:', ex);
		return { data: {}, content: raw };
	}
}

/**
 * Everything one post's front matter can change, in the right order: the post's
 * sidecar, then its flat keys, then the date's promoted `filePath` / metrics.
 * See `hikes-core`'s `applyPostOverrides`, the single definition of that order.
 *
 * Throws on a `metaPath` that names no known sidecar, rather than quietly
 * rendering the wrong map.
 */
export function applyPostOverrides(
	hike: Map,
	date: MapDate,
	frontmatter: Dict | null | undefined
): { hike: Map; date: MapDate; properties: MapProperties } {
	return applyWith(hike, date, frontmatter, getHikeMeta);
}

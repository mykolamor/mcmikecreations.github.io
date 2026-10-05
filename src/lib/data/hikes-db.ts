/**
 * Sidecar helpers: the per-slug `<slug>.hike.json` files that carry each hike's
 * hand-authored map fields (`name`, `description`, `image`, `origin`, `height`,
 * `checkpoints`, `nodes`), plus the conventions for locating a hike's files.
 *
 * The sidecars are the definitive list of which hikes exist — one per hike,
 * whether or not it has been blogged. Assembling whole hikes needs the markdown
 * as well, so that lives in the server-only `hikes.server`.
 *
 * Two things are addressable rather than derived, so a hike (or a single post on
 * it) can point somewhere other than the slug-named default:
 *
 *  - `metaPath` — which sidecar supplies the fields above.
 *  - `filePath` — which GeoJSON supplies the route geometry.
 *
 * Both may be set on a hike, on a single date, or in a post's front matter; see
 * `resolveHikeForDate` and `frontmatter.server`.
 *
 * The rules themselves are glob-free and live in `hikes-core.js`, shared with
 * the Node scripts; this module only supplies the globbed files.
 */

import type { HikeMeta, Map, MapDate } from './map-info';
import { resolveHikeForDate as resolveWith } from './hikes-core';

export {
	applyDateOverrides,
	defaultFilePath,
	defaultGpxPath,
	defaultMetaPath,
	hikeRoute,
	hikeSlug,
	withHikeMeta
} from './hikes-core';

const sidecars = import.meta.glob('/static/_projects/data-viz/hikes/markdown/*.hike.json', {
	eager: true,
	import: 'default'
}) as Record<string, HikeMeta>;

// Only the paths matter here, not the contents, so this stays lazy — Vite still
// resolves the key set at build time without inlining every GPX file.
const gpxFiles = import.meta.glob('/static/_projects/data-viz/hikes/**/*.gpx', { query: '?url' });
const gpxPaths = new Set(Object.keys(gpxFiles).map((key) => key.replace(/^\/static/, '')));

/** Whether a GPX file actually exists at the given served path. */
export function hasGpxFile(path: string): boolean {
	return gpxPaths.has(path);
}

/** Every hike's slug, taken from the sidecars on disk. */
export const hikeSlugs: string[] = Object.keys(sidecars)
	.map((key) => key.substring(key.lastIndexOf('/') + 1).replace(/\.hike\.json$/, ''))
	.sort();

/**
 * The sidecar at a served path such as
 * `/_projects/data-viz/hikes/markdown/laubeneck.hike.json`, or undefined if no
 * such file was globbed.
 */
export function getHikeMeta(metaPath: string): HikeMeta | undefined {
	return sidecars[`/static${metaPath}`];
}

/**
 * The hike as one of its dates sees it: the date's `metaPath` sidecar swapped in
 * and its `filePath` / metric overrides promoted. See `hikes-core`.
 */
export function resolveHikeForDate(hike: Map, date: MapDate): Map {
	return resolveWith(hike, date, getHikeMeta);
}

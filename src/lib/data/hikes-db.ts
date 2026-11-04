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

import type { HikeMeta, Map, MapDate, MapNode, OsmEntry, RawHikeMeta } from './map-info';
import { resolveHikeForDate as resolveWith } from './hikes-core';
import { resolveRef, resolveSidecar } from './osm-store';
import { formatPhoneTags } from './osm-phone';
import { readSidecarTexts } from '../hikes/facts.server';
import { readFactsLibrary, type FactsLibrary } from '../hikes/facts-library.server';

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
}) as Record<string, RawHikeMeta>;

const osmFiles = import.meta.glob('/static/_projects/data-viz/hikes/osm.json', {
	eager: true,
	import: 'default'
}) as Record<string, Record<string, OsmEntry>>;

/**
 * The shared OSM store: every element a sidecar or photo pin references, by
 * typed id (`node/123`). Server-only, like this module; pages get just the
 * elements they use.
 */
export const osmStore: Record<string, OsmEntry> = osmFiles['/static/_projects/data-viz/hikes/osm.json'] ?? {};

let allNodes: MapNode[] | undefined;

/**
 * Every element of the OSM store, resolved like a sidecar's nodes (author tags
 * merged, phones formatted), in store order. What a post's place mentions are
 * matched against; server-only — a page gets just the nodes it links to.
 */
export function storeNodes(): MapNode[] {
	return (allNodes ??= Object.keys(osmStore).map((ref) =>
		resolveRef(ref, osmStore, 'osm.json', { formatTags: formatPhoneTags })
	));
}

const libraryFiles = import.meta.glob('/static/_projects/data-viz/hikes/facts-library.json', {
	eager: true,
	import: 'default'
}) as Record<string, unknown>;

let library: FactsLibrary | undefined;

/**
 * The shared facts library, checked once per build: the records hikes' facts
 * `use` and their stops attach to. Server-only, like the OSM store.
 */
export function factsLibrary(): FactsLibrary {
	return (library ??= readFactsLibrary(libraryFiles['/static/_projects/data-viz/hikes/facts-library.json'] ?? {}, 'facts-library.json'));
}

/** Sidecars with their `nodes` resolved, by served path; filled on first use. */
const resolved: Record<string, HikeMeta> = {};

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
 * such file was globbed. A malformed translated `name` or `description` throws.
 */
export function getHikeMeta(metaPath: string): HikeMeta | undefined {
	const key = `/static${metaPath}`;
	const raw = sidecars[key];
	if (!raw) return undefined;
	return (resolved[key] ??= resolveSidecar(readSidecarTexts(raw, metaPath), osmStore, metaPath, { formatTags: formatPhoneTags }));
}

/**
 * The hike as one of its dates sees it: the date's `metaPath` sidecar swapped in
 * and its `filePath` / metric overrides promoted. See `hikes-core`.
 */
export function resolveHikeForDate(hike: Map, date: MapDate): Map {
	return resolveWith(hike, date, getHikeMeta);
}

import { getMapFeatures } from '$lib/data/map-get-features';
import type { Bailout, Text } from '$lib/hikes/facts-schema';

const Mode2d = '2d';
const Mode3d = '3d';
type Mode = typeof Mode2d | typeof Mode3d;

interface MapProvider {
	format: string;
	name: string;
	size: number;
	tileset: string;
	url: (x : number, y : number, z : number, params? : string) => string;
}

interface OriginData {
	lat: number;
	lon: number;
}

interface TilesMapsData {
	displacement?: string;
	diffuse?: string;
}

interface TilesData {
	provider: string;
	modes: Mode[];
	maps?: TilesMapsData;
}

interface GeometryData {
	provider: string;
	modes: string[];
	path?: string;
	feature?: object;
}

interface Feature {
	type: string;
	source: string;
	data: OriginData | TilesData | GeometryData;
}

/**
 * Per-hike map inputs. Everything else about the map stack (tile providers,
 * geometry provider and source, statistics) is identical for every hike and
 * lives in `map-get-features`.
 */
interface StandardFeatures {
	origin: OriginData;
}

interface MapNode {
	/** Typed OSM id, `node/123`, `way/4` or `relation/5`: the key into `osm.json`. */
	ref: string;
	lat: number;
	lon: number;
	/**
	 * Terrain height (m) under lat/lon as the post's 3D map renders it, from
	 * `pnpm crm terrain`. Placement only - `tags.ele` stays OSM's value.
	 */
	demEle?: number;
	tags: {
		[key: string]: string | null | undefined;
	};
}

/**
 * One element of the shared OSM store, `static/_projects/data-viz/hikes/osm.json`,
 * keyed there by typed id. Fetched by the Python tools (`osmstore.py`);
 * resolved into `MapNode`s by `osm-store.js`.
 */
interface OsmEntry {
	/** A way's or relation's centre. */
	lat: number;
	lon: number;
	/** Terrain height (m) under lat/lon, as for `MapNode.demEle`. */
	demEle?: number;
	/**
	 * My own tags, applied over `tags` (which OSM owns and a re-fetch replaces);
	 * `null` hides an OSM tag. Peaks carry `visited: 'yes' | 'no' | 'missing'` here.
	 */
	local?: { [key: string]: string | null };
	tags: { [key: string]: string | null | undefined };
	/** Day of the last fetch from OSM; absent for elements OSM no longer has. */
	fetched?: string;
}

interface MapDate {
	date: string;
	title?: string | undefined | null;
	description?: string | undefined | null;
	tags: string[];
	people: string[] | null;
	image?: string | undefined | null;
	path?: string | undefined | null;
	gpx?: string | undefined | null;
	author?: string | undefined | null;
	/**
	 * Per-post overrides of the hike's own fields, for dates that walked a
	 * different route or need their own numbers. All are optional and fall back
	 * to the hike level; see `hikes-db`'s `resolveHikeForDate`.
	 */
	metaPath?: string | undefined | null;
	filePath?: string | undefined | null;
	distance?: number | undefined | null;
	duration?: number | undefined | null;
	ascent?: number | undefined | null;
	descent?: number | undefined | null;
	/**
	 * The date's bailouts, resolved as its post page shows them: sidecar and
	 * post facts merged, places on the route, GPX routes summarised. Only in
	 * `/hikes/index.json`; see `bailouts.server`.
	 */
	bailouts?: Bailout[] | undefined;
}

interface MapProperties {
	/**
	 * Fallback metrics for the whole route. Absent on most hikes: they now live
	 * per post in front matter, and only routes with an unblogged date still keep
	 * them here. An explicit value always beats the GeoJSON's — see `mergeMetrics`.
	 */
	distance?: number | null;
	duration?: number | null;
	ascent?: number | null;
	descent?: number | null;
	dates: Array<MapDate>;
	/** Served path of the route GeoJSON. */
	filePath: string;
	/** Served path of the `<slug>.hike.json` sidecar, if not the slug-named one. */
	metaPath?: string | undefined;
	draft: boolean | null;
	hidden?: boolean | undefined;
	/** Coarse `[lon, lat]` outline of the route, drawn by the Web graph. */
	checkpoints?: Array<[number, number]> | undefined;
	nodes?: MapNode[] | undefined | null;
}

/**
 * The hand-authored half of a hike, stored per slug in
 * `static/_projects/data-viz/hikes/markdown/<slug>.hike.json`. None of it is
 * derivable from the route GeoJSON or from a post's front matter, so it lives
 * beside the markdown rather than in `hikes.json`. See `hikes-db`.
 */
interface HikeMeta {
	/** A plain string, or translated (`{ en, de }`); the hike itself reads the English. */
	name: string | Text;
	description: string | Text;
	image: string;
	/** Hand-picked map centre, unique per hike. */
	origin: OriginData;
	/** Hand-tuned render size of the map in pixels. */
	height: number;
	checkpoints: Array<[number, number]>;
	nodes?: MapNode[];
	/**
	 * Route-level defaults for the post's facts layer, merged under each post's
	 * own `facts`. Raw: validated by `readHikeFacts` (`facts.server.ts`).
	 */
	facts?: unknown;
	/**
	 * Place doc slugs shown under every post on this route that has no
	 * `places:` of its own. Raw: validated by `readPostPlaces` (`place-docs.server.ts`).
	 */
	places?: unknown;
}

/** A sidecar as stored on disk: `nodes` are typed ids into the OSM store. */
type RawHikeMeta = Omit<HikeMeta, 'nodes'> & { nodes?: string[] };

interface Map {
	/** The sidecar's English name, whether or not it is translated. */
	name: string;
	image: string;
	description: string;
	/** The sidecar's name and description in every language, when it translates them. */
	nameText?: Text;
	descriptionText?: Text;
	route: string;
	height: number;
	standardFeatures: StandardFeatures;
	properties: MapProperties;
}

export type {
	MapProvider, Map, MapProperties, MapNode, HikeMeta, RawHikeMeta, OsmEntry, Feature, GeometryData, TilesData, TilesMapsData, OriginData, Mode, MapDate
};
export {
	getMapFeatures
};

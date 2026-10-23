/**
 * Region outlines (scripts/region_shapes.py) as a Leaflet layer, for the Web
 * map and the hub pages: every region, one kind, or just the slugs a page is
 * about. The files are static GeoJSON, fetched when the layer is built.
 *
 * Browser-only (it takes the page's Leaflet instance), framework-free.
 */

import type * as Leaflet from 'leaflet';
import type { Feature, MultiPolygon } from 'geojson';
import { REGIONS, type Lang } from './facts-schema';
import { enumLabel } from './facts-format';

export const REGIONS_PATH = '/_projects/data-viz/hikes/regions/';

export type Region = (typeof REGIONS)[number];
/** `range`: a mountain range; `area`: the town, lake or valley a hike is known by. */
export type RegionKind = 'range' | 'area';

export interface RegionIndexEntry {
	slug: Region;
	kind: RegionKind;
	/** `[minLon, minLat, maxLon, maxLat]` */
	bbox: [number, number, number, number];
}

export interface RegionProperties {
	slug: Region;
	kind: RegionKind;
	/** `osm`, `buffer` (a lake or valley line grown) or `split` (derived from another region). */
	source: 'osm' | 'buffer' | 'split';
	osm?: string[];
	attribution: string;
}

export type RegionFeature = Feature<MultiPolygon, RegionProperties>;

export interface RegionLayerOptions {
	/** Only these regions; default every region in the index. */
	slugs?: readonly Region[];
	/** Only regions of this kind. */
	kind?: RegionKind;
	lang?: Lang;
	/** A Leaflet pane to draw in; `addRegionPane` makes one under the routes. */
	pane?: string;
	fetch?: typeof fetch;
}

export async function loadRegionIndex(fetchFn: typeof fetch = fetch): Promise<RegionIndexEntry[]> {
	const res = await fetchFn(`${REGIONS_PATH}index.json`);
	if (!res.ok) throw new Error(`Region index: HTTP ${res.status}`);
	return res.json();
}

export async function loadRegion(slug: Region, fetchFn: typeof fetch = fetch): Promise<RegionFeature> {
	const res = await fetchFn(`${REGIONS_PATH}${slug}.json`);
	if (!res.ok) throw new Error(`Region ${slug}: HTTP ${res.status}`);
	return res.json();
}

// Ranges in muted, distinguishable hues; areas share one colour and a dashed edge.
const RANGE_COLORS = ['#2f6f9f', '#8a5a2b', '#5b7f2e', '#7a4f9a', '#b0413e', '#2e8076', '#9a7b1f', '#4b5d8a'];
const AREA_COLOR = '#c2410c';

/** A region's line and fill; the same slug always gets the same colour. */
export function regionStyle(slug: Region, kind: RegionKind): Leaflet.PathOptions {
	if (kind === 'area') {
		return { color: AREA_COLOR, weight: 2, opacity: 0.9, dashArray: '6 4', fillColor: AREA_COLOR, fillOpacity: 0.06 };
	}
	const color = RANGE_COLORS[Math.max(0, REGIONS.indexOf(slug)) % RANGE_COLORS.length];
	return { color, weight: 2, opacity: 0.8, fillColor: color, fillOpacity: 0.1 };
}

/** A pane for region outlines, under the routes (overlayPane is 400) and above the tiles. */
export function addRegionPane(map: Leaflet.Map, name = 'regions'): string {
	if (!map.getPane(name)) {
		const pane = map.createPane(name);
		pane.style.zIndex = '350';
	}
	return name;
}

/**
 * The regions as one GeoJSON layer, each with a tooltip naming it. Ranges
 * come first so areas draw on top of the range they sit in.
 */
export async function regionLayer(L: typeof Leaflet, options: RegionLayerOptions = {}): Promise<Leaflet.GeoJSON> {
	const { slugs, kind, lang = 'en', pane, fetch: fetchFn = fetch } = options;
	const index = await loadRegionIndex(fetchFn);
	const wanted = index
		.filter((e) => (!slugs || slugs.includes(e.slug)) && (!kind || e.kind === kind))
		.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'range' ? -1 : 1));
	const features = await Promise.all(wanted.map((e) => loadRegion(e.slug, fetchFn)));

	return L.geoJSON(features, {
		...(pane ? { pane } : {}),
		style: (f) => regionStyle(f!.properties.slug, f!.properties.kind),
		onEachFeature: (f: RegionFeature, layer) => {
			layer.bindTooltip(enumLabel(lang, 'region', f.properties.slug), { sticky: true });
		}
	});
}

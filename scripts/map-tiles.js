// Pure tile computation shared by map-download.js (CLI) and the hike CRM (status). No side effects on import.
import { geoMercator } from 'd3-geo';
import { tile } from 'd3-tile';
// noinspection ES6PreferShortImport
import { providers, providerFolder, providerFile } from '../src/lib/data/map-providers.js';
// noinspection ES6PreferShortImport
import { getMapFeatures } from '../src/lib/data/map-get-features.js';
// noinspection ES6PreferShortImport
import { hikeSlug } from '../src/lib/data/hikes-core.js';

/** Folder of the tile sets, relative to scripts/ (where map-download.js runs). */
export const mapFolder = `../static/${providerFolder}/maps`;

/** Folder of the tile sets under a repo root. */
export const mapFolderUnder = (/** @type {string} */ root) => `${root}/static/${providerFolder}/maps`;

/** Providers map-download.js fetches for every tile, in its download order. */
export const downloadedProviders = [
	providers.mapboxDEM,
	providers.nextzenTerrariumDEM,
	providers.osm,
	providers.mapboxSatellite,
	providers.mapyOutdoor,
];

/** `<tileset>/<z>_<x>_<y>.<format>` for a provider, relative to the map folder. */
export const tileFileName = (/** @type {{tileset: string, format: string}} */ provider, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
	providerFile(x, y, z, provider.tileset, provider.format);

/**
 * The [x, y, z] tiles one rendered view of a hike needs.
 * @returns {import('d3-tile').Tiles}
 */
export function tilesForView(view) {
	const features = getMapFeatures(view);
	const origin = features.find((x) => x.type === 'Origin');
	if (!origin) throw new Error(`Failed to find origin for ${view.route ?? 'hike'}.`);

	const height = view.height;
	const projection = geoMercator()
		.center([origin.data.lon, origin.data.lat])
		.scale(Math.pow(2, 21) / (2 * Math.PI))
		.translate([height / 2, height / 2]);

	const tileFunc = tile()
		.size([height, height])
		.scale(projection.scale() * 2 * Math.PI)
		.translate(/** @type {[number, number]} */ (projection([0, 0])));
	return tileFunc();
}

/**
 * The hike as the map page renders it, plus each post as that post's page renders it (front matter may move the
 * origin or resize the map); one view per distinct origin/height. `resolvePost(hike, date)` returns the resolved hike.
 */
export function viewsFor(hikes, resolvePost) {
	const views = [];
	const seen = new Set();
	for (const hike of hikes) {
		const posts = hike.properties.dates.filter((d) => d.path).map((d) => resolvePost(hike, d));
		for (const view of [hike, ...posts]) {
			const { lat, lon } = view.standardFeatures.origin;
			const key = `${lat},${lon},${view.height}`;
			if (seen.has(key)) continue;
			seen.add(key);
			views.push(view);
		}
	}
	return views;
}

export { hikeSlug, providers };

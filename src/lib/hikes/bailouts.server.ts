/**
 * A date's bailouts as its post page resolves them — the sidecar's route
 * defaults with the post's own `facts` merged on top, places projected onto
 * the route, planned GPX routes summarised — for `/hikes/index.json`.
 *
 * Warnings are not logged here: the post page reads the same facts and
 * reports them once.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { Map as Hike, MapDate } from '$lib/data/map-info';
import { defaultMetaPath, getHikeMeta } from '$lib/data/hikes-db';
import { readHikeFacts } from '$lib/hikes/facts.server';
import type { Bailout } from '$lib/hikes/facts-schema';
import { applyPostOverrides, readMetaPathOverride } from '$lib/hikes/frontmatter.server';
import { getPostFrontmatter } from '$lib/hikes/hikes.server';
import { computeMetricScales, mergeMetrics } from '$lib/hikes/hike-metrics';

type Geo = { coords: number[][] | null; props: Parameters<typeof mergeMetrics>[1] | null };
const geoCache = new Map<string, Geo>();

/** The route GeoJSON's first feature, read once per served path. */
function readGeo(servedPath: string): Geo {
	let geo = geoCache.get(servedPath);
	if (!geo) {
		geo = { coords: null, props: null };
		const file = `static${servedPath}`;
		if (existsSync(file)) {
			const feature = JSON.parse(readFileSync(file, 'utf-8'))?.features?.[0];
			geo = { coords: feature?.geometry?.coordinates ?? null, props: feature?.properties ?? null };
		}
		geoCache.set(servedPath, geo);
	}
	return geo;
}

const readGpx = (servedPath: string) =>
	existsSync(`static${servedPath}`) ? readFileSync(`static${servedPath}`, 'utf-8') : null;

/** The date's bailouts, nearest first along the route, or undefined when it has none. */
export function readDateBailouts(hike: Hike, date: MapDate): Bailout[] | undefined {
	const frontmatter = getPostFrontmatter(date.path);
	const { properties } = applyPostOverrides(hike, date, frontmatter);
	const slug = hike.route.substring(hike.route.lastIndexOf('/') + 1);
	const metaPath = readMetaPathOverride(frontmatter, date) ?? properties.metaPath ?? defaultMetaPath(slug);
	const sidecar = getHikeMeta(metaPath);

	const { coords, props } = readGeo(properties.filePath);
	const metrics = props ? { ...properties, ...mergeMetrics(properties, props) } : properties;

	const { facts } = readHikeFacts({
		post: frontmatter?.facts,
		sidecar: sidecar?.facts,
		postSource: date.path ?? `${slug} ${date.date}`,
		sidecarSource: metaPath,
		nodes: properties.nodes,
		coords,
		distanceFactor: coords ? computeMetricScales(coords, metrics).distanceFactor : 1,
		readGpx
	});
	return facts?.bailouts?.length ? facts.bailouts : undefined;
}

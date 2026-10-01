/* eslint-disable @typescript-eslint/ban-ts-comment */
import { error, redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { HttpError } from '@sveltejs/kit'
import { geoMercator } from 'd3-geo';
// @ts-ignore
import { tile } from 'd3-tile';
import * as THREE from 'three';
import { type Feature, type GeometryData, getMapFeatures, type Map, type OriginData } from '$lib/data/map-info';
import { buildGeometry, loadGeometry, loadProperties } from '$lib/hikes/build-geometry';
import { buildTiles, getPixelsPerMeter } from '$lib/hikes/build-tiles';
import { buildStatistics } from '$lib/hikes/build-statistics';

export const load: PageLoad = async ({ data, fetch, params }) => {
	try {
		// The hike itself is looked up server-side; everything below stays here
		// because it builds THREE objects, which cannot cross a server boundary.
		const meta : Map = data.meta;

		const dates = [...meta.properties.dates].sort((a, b) => a.date > b.date ? -1 : 1);

		let gpxPath: string | null =
			dates[0]?.gpx ?? meta.properties.filePath.replace('geojson', 'gpx').replace('json', 'gpx');

		do {
			// Only redirect if every date has a blog post (markdown).
			if (dates.length == 0) break;
			if (!dates.every(d => d.path)) break;

			const date = dates[0];

			const markdownFile = await fetch(date.path!, { method: 'OPTIONS' });
			if (!markdownFile.ok) break;

			const url = `/hikes/${date.date}-${params.slug}/`;
			redirect(301, url);
		} while (false);

		if (!(await fetch(gpxPath, { method: 'OPTIONS' })).ok) {
			gpxPath = null;
		}

		// Fully-blogged hikes redirected above, so anything still here has at most
		// some dates blogged. Where one is, its post carries this route's prose, so
		// point the canonical at it rather than competing with it.
		const bloggedDate = dates.find(d => d.path);
		const canonical = bloggedDate ? `/hikes/${bloggedDate.date}-${params.slug}/` : undefined;

		const features: Feature[] = getMapFeatures(meta);

		const statistics = features.find((x: Feature) => x.type === 'Statistics');
		const origin = features.find((x: Feature) => x.type === 'Origin');

		if (!origin) {
			console.log(`Failed to find origin for /maps/${params.slug}.`);
			error(404, { message: `Failed to find origin for "${params.slug}"` });
		}

		const height = meta.height;
		const originData : OriginData = origin.data as OriginData;

		const projection = geoMercator()
			.center([originData.lon, originData.lat])
			.scale(Math.pow(2, 21) / (2 * Math.PI))
			.translate([height / 2, height / 2]);

		const tileFunc = tile()
			.size([height, height])
			.scale(projection.scale() * 2 * Math.PI)
			.translate(projection([0, 0]) ?? [0, 0]);
		const tiles = tileFunc();
		const pixelsPerMeter = getPixelsPerMeter(originData.lat, tiles.scale, tileFunc.scale()());

		const layers2d : Array<string> = [];
		const layers3d : Array<THREE.Object3D> = [];
		const layersGeometry : Array<object> = [];
		let properties = meta.properties;

		for (const layer of features) {
			let data;
			if (layer.type === 'Tiles') {
				data = await buildTiles(fetch, layer, tiles, tileFunc);
			} else if (layer.type === 'Geometry') {
				const geometry = await loadGeometry(fetch, layer.data as GeometryData);
				layersGeometry.push(geometry);
				properties = loadProperties(meta, geometry);
				data = await buildGeometry(fetch, layer, geometry, projection, pixelsPerMeter, tiles, tileFunc);
			}

			if (data) {
				if (data.layers2d.length > 0) {
					layers2d.push(...data.layers2d);
				}
				if (data.layers3d.length > 0) {
					layers3d.push(...data.layers3d);
				}
			}
		}

		const posts: { date: string, post: string }[] = [];
		/*for (const date of properties.dates) {
			if (!date.path) continue;
			try {
				const res = await fetch(date.path);
				if (res.ok) {
					const post = await res.text();
					posts.push({ date: date.date, post: post });
				}
			} catch (e) {
				// empty
			}
		}*/

		return {
			map: meta,
			properties: properties,
			gpxPath: gpxPath,
			canonical: canonical,
			origin: originData,
			statistics: statistics
				? ((await buildStatistics(fetch, statistics, height, undefined))?.layers2d?.join(''))
				: undefined,
			projection: projection,
			tileScale: tiles.scale,
			pixelsPerMeter: pixelsPerMeter,
			posts: posts,
			dataGeometry: layersGeometry,
			data2d: layers2d.join(''),
			data3d: layers3d,
			toc: {
				enabled: false,
			}
		};
	} catch (ex) {
		if ((ex as HttpError) !== undefined) {
			throw ex;
		} else {
			console.log(ex);
			error(500);
		}
	}
};

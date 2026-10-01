import type { Feature, GeometryData } from '$lib/data/map-info';
import { type GeoProjection } from 'd3-geo';
import * as THREE from 'three';
import { loadGeometry, secondaryGeometryColor } from '$lib/hikes/build-geometry';

export function getDistance(m : number) {
	const km = Math.floor(m / 1000);
	const lm = Math.floor(m - 1000 * km);
	return ((km == 0 ? '' : `${km} km `) + (lm == 0 ? '' : `${lm} m`)).trimEnd();
}

export function getTime(m : number) {
	const days = Math.floor(m / 60 / 24);
	const hours = Math.floor(m / 60 - days * 24);
	const lm = Math.round(m - days * 60 * 24 - hours * 60);
	return ((days == 0 ? '' : `${days} days `) + (hours == 0 ? '' : `${hours} hours `) + (lm == 0 ? '' : `${lm} min`)).trimEnd();
}

export async function buildStatistics(
	fetch : (input: (RequestInfo | URL), init?: (RequestInit | undefined)) => Promise<Response>,
	layer : Feature,
	height : number,
	rectHeightParam: number | undefined
) {
	const result : {
		layers2d: Array<string>,
		layers3d: Array<THREE.Object3D>,
	} = {
		layers2d: [],
		layers3d: [],
	};

	const layerData : GeometryData = layer.data as GeometryData;
	const geometry = await loadGeometry(fetch, layerData);

	if (layerData.modes.includes('2d')) {
		const points = geometry.geometry.coordinates;
		const [minHeight, maxHeight] = points.reduce(
			([minH, maxH] : Array<number>, curr: Array<number>) => [
				curr[2] < minH ? curr[2] : minH,
				curr[2] > maxH ? curr[2] : maxH
			],
			[points[0][2], points[0][2]]
		);
		const deltaHeight = minHeight === maxHeight ? 1.0 : maxHeight - minHeight;
		const containerSize = height * 0.5;
		const rectWidth = containerSize / points.length;
		const rectHeight = rectHeightParam ?? height * 0.125;
		const rectangles = points.map((x : Array<number>, i : number) : string =>
			`<rect width="${rectWidth}" height="${rectHeight}" x="${i * rectWidth}" fill="transparent" data-x="${x[0]}" data-y="${x[1]}" data-z="${x[2]}" data-dz="${x[2].toFixed(1)}" data-h="${rectHeight - (x[2] - minHeight) / deltaHeight * rectHeight}" />`
		).join('');
		const paths = points.map((x : Array<number>, i : number) : string => `${i * rectWidth},${rectHeight - (x[2] - minHeight) / deltaHeight * rectHeight}`).join(' ');
		result.layers2d.push(`<g><path fill="none" stroke-width="${rectHeight / 48}" stroke="${secondaryGeometryColor}" d="M 0,${rectHeight - (points[0][2] - minHeight) / deltaHeight * rectHeight} L ${paths}" /></g>`);
		result.layers2d.push(`
<g fill="var(--tw-prose-body)" style="font-size: ${10 * rectHeight / 48}px" class="align-middle">
	<text y="${rectHeight - 5 * rectHeight / 48}">${Math.round(minHeight)} m</text>
	<text y="${5 * rectHeight / 48}">${Math.round(maxHeight)} m</text>
	<rect width="0" height="${15 * rectHeight / 48}" x=${containerSize} y="${-7.5 * rectHeight / 48}" class="fill-gray-200 dark:fill-gray-700" />
	<text x=${containerSize} y="${5 * rectHeight / 48}" text-anchor="end" class="statsHeightIndicator"></text>
</g>`);
		result.layers2d.push(`<g id="statsRects">${rectangles}</g>`);
	}

	return result;
}

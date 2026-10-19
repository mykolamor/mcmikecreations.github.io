/**
 * The hero map's heightmap on the CPU: decoded once, sampled exactly like
 * demHeightGlsl (src/lib/hikes/meshline/dem-height.ts) samples the same image
 * on the GPU, so the route and the peaks sit on the drawn contours.
 */
import type { HeroBounds } from '../hikes/hero-map';

const DEM_BUFFER_PX = 1;

export interface HeightField {
	/** Full width = height of the image, border included. */
	size: number;
	/** Metres, row-major, row 0 = north. */
	heights: Float32Array;
}

export function decodeTerrainRgb(rgba: Uint8ClampedArray | Uint8Array, size: number): HeightField {
	const heights = new Float32Array(size * size);
	for (let i = 0; i < heights.length; i++) {
		heights[i] = -10000 + (rgba[i * 4] * 65536 + rgba[i * 4 + 1] * 256 + rgba[i * 4 + 2]) * 0.1;
	}
	return { size, heights };
}

/** Bilinear height at (u east, v north), both 0..1 across the inner square. */
export function sampleHeight(field: HeightField, u: number, v: number): number {
	const { size, heights } = field;
	const inner = size - 2 * DEM_BUFFER_PX;
	const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
	const x = clamp01(u) * inner - 0.5 + DEM_BUFFER_PX;
	const y = (1 - clamp01(v)) * inner - 0.5 + DEM_BUFFER_PX;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const at = (c: number, r: number) =>
		heights[Math.min(size - 1, Math.max(0, r)) * size + Math.min(size - 1, Math.max(0, c))];
	const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
	const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
	return top * (1 - fy) + bottom * fy;
}

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Position inside the heightmap's square: u east, v north, 0..1 inside it. */
export function toUv(bounds: HeroBounds, lon: number, lat: number): { u: number; v: number } {
	const south = mercatorY(bounds.south);
	return {
		u: (lon - bounds.west) / (bounds.east - bounds.west),
		v: (mercatorY(lat) - south) / (mercatorY(bounds.north) - south)
	};
}

/**
 * The route as runs of in-square points (u/v), split wherever it leaves the
 * square; runs of fewer than two points are dropped. Long routes are thinned
 * to about `maxPoints` in total, keeping every run's last point.
 */
export function routeRuns(
	geometry: { type: string; coordinates: unknown },
	bounds: HeroBounds,
	maxPoints = 2000
): { u: number; v: number }[][] {
	const lines = (geometry.type === 'MultiLineString'
		? geometry.coordinates
		: geometry.type === 'LineString' ? [geometry.coordinates] : []) as number[][][];
	const total = lines.reduce((n, l) => n + l.length, 0);
	const stride = Math.max(1, Math.ceil(total / maxPoints));
	const inside = (p: { u: number; v: number }) => p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1;
	const runs: { u: number; v: number }[][] = [];
	for (const line of lines) {
		let run: { u: number; v: number }[] = [];
		const flush = () => {
			if (run.length >= 2) runs.push(run);
			run = [];
		};
		line.forEach(([lon, lat], i) => {
			const p = toUv(bounds, lon, lat);
			if (!inside(p)) return flush();
			const nextOutside = i + 1 >= line.length || !inside(toUv(bounds, line[i + 1][0], line[i + 1][1]));
			if (run.length === 0 || i % stride === 0 || nextOutside) run.push(p);
		});
		flush();
	}
	return runs;
}

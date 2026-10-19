// Run with: node_modules/.bin/jiti src/lib/hero-map/heightfield.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerrainRgb, routeRuns, sampleHeight, toUv } from './heightfield';

const encode = (h: number) => {
	const e = Math.round((h + 10000) / 0.1);
	return [(e >> 16) & 255, (e >> 8) & 255, e & 255, 255];
};
/** size x size field whose height is 1000 + 10 * row (row 0 = north). */
const field = (size: number) => {
	const rgba = new Uint8Array(size * size * 4);
	for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) rgba.set(encode(1000 + 10 * r), (r * size + c) * 4);
	return decodeTerrainRgb(rgba, size);
};

test('decodeTerrainRgb reads Mapbox Terrain-RGB', () => {
	const f = field(4);
	assert.ok(Math.abs(f.heights[0] - 1000) < 0.05);
	assert.ok(Math.abs(f.heights[3 * 4] - 1030) < 0.05);
});

test('sampleHeight: v = 1 is the north (top) row, skipping the border', () => {
	const f = field(10); // 8 inner rows + border; inner row j sits at file row j + 1
	// v = 1 - 0.5/8 is the centre of the first inner row (file row 1).
	assert.ok(Math.abs(sampleHeight(f, 0.5, 1 - 0.5 / 8) - 1010) < 0.05);
	assert.ok(Math.abs(sampleHeight(f, 0.5, 0.5 / 8) - 1080) < 0.05);
	// Halfway between inner rows 0 and 1 interpolates.
	assert.ok(Math.abs(sampleHeight(f, 0.5, 1 - 1 / 8) - 1015) < 0.05);
});

const B = { west: 11.0, south: 47.0, east: 11.1, north: 47.1 };

test('toUv maps the corners and is Mercator in latitude', () => {
	assert.deepEqual(toUv(B, 11.0, 47.0), { u: 0, v: 0 });
	const ne = toUv(B, 11.1, 47.1);
	assert.ok(Math.abs(ne.u - 1) < 1e-12 && Math.abs(ne.v - 1) < 1e-12);
	assert.ok(Math.abs(toUv(B, 11.05, 47.05).v - 0.5) < 1e-3);
});

test('routeRuns splits where the route leaves the square', () => {
	const runs = routeRuns({
		type: 'LineString',
		coordinates: [[11.01, 47.01], [11.02, 47.02], [12.0, 47.5], [11.03, 47.03], [11.04, 47.04]]
	}, B);
	assert.equal(runs.length, 2);
	assert.equal(runs[0].length, 2);
	assert.equal(runs[1].length, 2);
});

test('routeRuns handles MultiLineString and drops single points', () => {
	const runs = routeRuns({
		type: 'MultiLineString',
		coordinates: [[[11.01, 47.01], [11.02, 47.02]], [[11.05, 47.05]]]
	}, B);
	assert.equal(runs.length, 1);
});

test('routeRuns thins long routes to maxPoints overall, keeping each run\'s ends', () => {
	const coords = Array.from({ length: 1000 }, (_, i) => [11.0001 + i * 0.00009, 47.05]);
	const [run] = routeRuns({ type: 'LineString', coordinates: coords }, B, 100);
	assert.ok(run.length <= 101);
	assert.deepEqual(run.at(-1), toUv(B, coords[999][0], coords[999][1]));
});

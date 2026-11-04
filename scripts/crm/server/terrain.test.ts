import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTerrain, decodeHeight, pyRound1, tilePosition } from './terrain';

const DEM = new URL('../../../static/_projects/data-viz/maps/mapbox-terrain-dem-v1', import.meta.url).pathname;
const OSM = new URL('../../../static/_projects/data-viz/hikes/osm.json', import.meta.url).pathname;

test('decodeHeight and tilePosition', () => {
	assert.equal(decodeHeight(0, 0, 0), -10000);
	assert.ok(Math.abs(decodeHeight(1, 134, 160) - 0) < 1e-6);
	const [x, y] = tilePosition(0, 0, 1);
	assert.deepEqual([x, y], [1, 1]);
});

test('null when the tile is missing', () => {
	assert.equal(createTerrain(mkdtempSync(path.join(tmpdir(), 'dem-'))).height(47.7, 11.5), null);
});

test('matches Python for every osm.json entry with demEle whose DEM tile exists', () => {
	const store = JSON.parse(readFileSync(OSM, 'utf8')) as Record<string, { lat?: number; lon?: number; demEle?: number }>;
	const have = new Set(readdirSync(DEM));
	const terrain = createTerrain(DEM);
	let compared = 0;
	for (const [ref, e] of Object.entries(store)) {
		if (typeof e.demEle !== 'number' || typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
		const [x, y] = tilePosition(e.lat, e.lon);
		if (!have.has(`13_${Math.floor(x)}_${Math.floor(y)}.png`)) continue;
		assert.equal(terrain.height(e.lat, e.lon), e.demEle, ref);
		compared++;
	}
	console.log(`compared ${compared} osm.json entries`);
	assert.ok(compared > 0);
});

test('pyRound1 matches Python round(x, 1)', () => {
	const cases: [number, number][] = [[0.25, 0.2], [1.25, 1.2], [-0.25, -0.2], [0.75, 0.8], [2.5, 2.5], [2.675, 2.7], [1576.95, 1577], [-0.75, -0.8], [0.05, 0.1], [0, 0]];
	for (const [x, want] of cases) assert.equal(pyRound1(x), want, String(x));
});

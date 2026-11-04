import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squareBounds, squareHalfMetres, groundSizeKm, heightForCorner } from './tile-square';
import { insideTileSquare } from '$lib/hikes/place-links';
import { repoPaths } from '../server/paths';
import { loadHikesFrom } from '../../load-hikes.js';
import { tilesForView } from '../../map-tiles.js';

const ROOT = new URL('../../..', import.meta.url).pathname;
const origin = { lat: 47.7, lon: 11.5 };

test('squareBounds spans the half-side and groundSizeKm is about 6.6 km at 47.7 N, 512 px', () => {
	const b = squareBounds(origin, 512);
	const half = squareHalfMetres(origin.lat, 512);
	const northM = (b.north - origin.lat) * 111194.9266;
	const eastM = (b.east - origin.lon) * 111194.9266 * Math.cos((origin.lat * Math.PI) / 180);
	assert.ok(Math.abs(northM - half) < 1 && Math.abs(eastM - half) < 1);
	assert.ok(Math.abs(groundSizeKm(origin.lat, 512) - 6.6) <= 0.05);
});

test('half-side agrees with insideTileSquare in place-links', () => {
	const b = squareBounds(origin, 512);
	const node = (lat: number, lon: number) => ({ lat, lon }) as any;
	assert.ok(insideTileSquare(node(b.north - 1e-5, b.east - 1e-5), origin, 512));
	assert.ok(!insideTileSquare(node(b.north + 1e-5, origin.lon), origin, 512));
	assert.ok(!insideTileSquare(node(origin.lat, b.east + 1e-5), origin, 512));
});

test('heightForCorner round-trips, rounds to 16 px and clamps to 128..2048', () => {
	const b = squareBounds(origin, 512);
	assert.equal(heightForCorner(origin, { lat: b.north, lon: b.east }), 512);
	assert.equal(heightForCorner(origin, { lat: b.south, lon: b.west }), 512);
	assert.equal(heightForCorner(origin, { lat: origin.lat + 0.0001, lon: origin.lon }), 128);
	assert.equal(heightForCorner(origin, { lat: origin.lat + 5, lon: origin.lon }), 2048);
	const c = squareBounds(origin, 520); // 520 px is 8 over a multiple of 16: rounds to nearest
	assert.equal(heightForCorner(origin, { lat: c.north, lon: c.east }) % 16, 0);
});

test('the tiles map-download fetches cover the square', () => {
	const p = repoPaths(ROOT);
	const hikes = loadHikesFrom(p.static, p.hikesJson, { fresh: true }).filter((h: any) => h.standardFeatures?.origin && h.height);
	assert.ok(hikes.length >= 3);
	for (const hike of hikes.slice(0, 3)) {
		const tiles = tilesForView(hike);
		const { lat, lon } = hike.standardFeatures.origin;
		const b = squareBounds({ lat, lon }, hike.height);
		const tileOf = (la: number, lo: number) => {
			const n = 2 ** 13;
			return [Math.floor(((lo + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2) * n)];
		};
		for (const [la, lo] of [[b.north, b.west], [b.north, b.east], [b.south, b.west], [b.south, b.east]]) {
			const [tx, ty] = tileOf(la, lo);
			assert.ok(tiles.some(([x, y]) => x === tx && y === ty), `corner ${la},${lo} (tile ${tx}/${ty}) not in tiles for ${hike.route}`);
		}
	}
});

// Run with: node_modules/.bin/jiti src/lib/hikes/facts-overlay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFactsOverlay, chartPins, offsetNearRoute, pinEmojis, pinColor, routeSlice } from './facts-overlay';
import type { HikeAuthoredFacts, Place } from './facts-schema';

// A straight route north along lon 11.0: 11 points ~1.11 km apart.
const COORDS = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const STEP = 1.112;

const at = (name: string, km: number, node?: number): Place => ({
	name: { en: name }, lat: 47.0 + km / STEP / 100, lon: 11.0, km, ele: 1000, resolved: true, ...(node != null ? { node } : {})
});

test('routeSlice cuts the route between two distances, ends interpolated', () => {
	const slice = routeSlice(COORDS, 1, 1.5, 3.5);
	assert.ok(Math.abs(slice[0][0] - (47.0 + 1.5 / STEP / 100)) < 1e-4);
	assert.ok(Math.abs(slice[slice.length - 1][0] - (47.0 + 3.5 / STEP / 100)) < 1e-4);
	// Interior points 2 and 3 in between.
	assert.equal(slice.length, 4);
	assert.deepEqual(routeSlice(COORDS, 1, 0, 1)[0], [47.0, 11.0]);
});

test('pins group by place; spans become bands and map lines', () => {
	const facts: HikeAuthoredFacts = {
		hazards: [
			{ kind: 'rockfall', from: at('A', 2), to: at('B', 4), severity: 'high' },
			{ kind: 'cattle', at: at('Hut', 5, 7), severity: 'low' },
			{ kind: 'cold' },
			{ kind: 'mud', from: { name: { en: 'Nowhere' }, resolved: false } }
		],
		bailouts: [{ at: at('Hut', 5, 7), via: 'hut' }],
		water: [{ at: at('Hut', 5, 7), kind: 'hut' }, { at: at('Spring', 8) }],
		difficulty: { sections: [{ to: at('B', 4), sac: 'T2' }, { from: at('B', 4), sac: 'T4+' }] }
	};
	const o = buildFactsOverlay(facts, 'en', COORDS, 1);
	assert.equal(o.pins.length, 2);
	const hut = o.pins[0];
	assert.equal(hut.onNode, true);
	assert.deepEqual(hut.items.map((i) => i.kind), ['hazard', 'bailout', 'water']);
	assert.equal(pinEmojis(hut), '⚠️🛟💧');
	assert.equal(hut.items[0].title, 'Cattle (low)');
	assert.equal(pinColor(o.pins[1]), '#0ea5e9');

	// One hazard stretch (the unresolved one is dropped), two grade sections with open ends.
	const hazardBands = o.bands.filter((b) => b.row === 1);
	assert.equal(hazardBands.length, 1);
	assert.deepEqual([hazardBands[0].from, hazardBands[0].to], [2, 4]);
	const grades = o.bands.filter((b) => b.row === 0);
	assert.deepEqual(grades.map((b) => [b.from, b.text]), [[0, 'T2'], [4, 'T4+']]);
	assert.ok(Math.abs(grades[1].to - 10 * STEP) < 0.01);
	assert.equal(grades[1].color, '#3b82f6');
	assert.equal(o.lines.length, 1);
	assert.ok(o.lines[0].coords.length >= 2);
});

test('chartPins merges pins that would overlap on the chart', () => {
	const o = buildFactsOverlay(
		{ water: [{ at: at('A', 3) }, { at: at('B', 3.02) }], bailouts: [{ at: { ...at('Off', 0), km: undefined } }] },
		'en', COORDS, 1
	);
	const merged = chartPins(o.pins);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].name, 'A, B');
	assert.equal(merged[0].items.length, 2);
});

test('no facts, no overlay', () => {
	assert.deepEqual(buildFactsOverlay(null, 'en', COORDS, 1), { pins: [], bands: [], lines: [], routes: [] });
});

test('bailout routes become dashed-line routes', () => {
	const route = { url: '/b.gpx', coords: [[47, 11], [47.01, 11]] as [number, number][], distance: 1112, descent: 300, ascent: 0, duration: 36 };
	const o = buildFactsOverlay({ bailouts: [{ at: at('Hut', 5, 7), to: { en: 'Valley' }, route, last: true }] }, 'en', COORDS, 1);
	assert.equal(o.routes.length, 1);
	assert.equal(o.routes[0].color, '#dc2626');
	assert.equal(o.routes[0].title.replace(/\u00a0/g, ' '), 'Planned route: Hut → Valley\n1.1 km · ↑ 0 m · ↓ 300 m · ≈ 30 min');
	// Stats don't break inside themselves.
	assert.ok(o.routes[0].title.includes('≈\u00a030\u00a0min'));
});

test('offsetNearRoute pushes shared stretches along the normal, fading out', () => {
	// Main route along y = 0, x 0..100. The line runs along it, then turns away north (screen up).
	const main = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
	const line = [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 60, y: 0 }, { x: 60, y: -9 }, { x: 60, y: -40 }];
	const out = offsetNearRoute(line, main, 7, 6, 12);
	// Heading +x on screen, the left-hand normal points up: y decreases by the full offset.
	assert.deepEqual(out[0], { x: 20, y: -7 });
	assert.deepEqual(out[1], { x: 40, y: -7 });
	// 9 px away: half weight, pushed along that point's own normal (direction is up the screen, left is -x).
	assert.ok(Math.abs(out[3].x - (60 - 3.5)) < 1e-9 && out[3].y === -9);
	// Far from the main route: untouched.
	assert.deepEqual(out[4], line[4]);
	// A negative offset goes to the other side.
	assert.deepEqual(offsetNearRoute(line, main, -7, 6, 12)[1], { x: 40, y: 7 });
});

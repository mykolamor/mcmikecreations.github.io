// Run with: node_modules/.bin/jiti src/lib/hikes/hero-map.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignLabels, buildCandidates, candidatesScriptJson, contourInterval, fitDistance, haversine, reassignLabels, selectPeaks, smallestFit, type HeroMeta, type HeroPeak } from './hero-map';
import type { Map, MapNode } from '../data/map-info';

const peak = (name: string, lat: number, lon: number, ele: number): HeroPeak => ({ name, lat, lon, ele });

test('haversine: one degree of latitude is ~111.2 km', () => {
	assert.ok(Math.abs(haversine({ lat: 47, lon: 11 }, { lat: 48, lon: 11 }) - 111_195) < 50);
});

test('selectPeaks starts at the highest and spreads out', () => {
	const peaks = [
		peak('low-west', 47.0, 11.00, 1500),
		peak('high-mid', 47.0, 11.05, 2500),
		peak('near-high', 47.0, 11.051, 2400),
		peak('east', 47.0, 11.11, 1800)
	];
	// east is 0.06° from high-mid, low-west 0.05°: east comes second, then low-west, never near-high.
	const chosen = selectPeaks(peaks, 3).map((p) => p.name);
	assert.deepEqual(chosen, ['high-mid', 'east', 'low-west']);
});

test('selectPeaks returns all when there are no more than needed, and is deterministic', () => {
	const peaks = [peak('a', 47, 11, 1), peak('b', 47.01, 11, 2)];
	assert.equal(selectPeaks(peaks, 5).length, 2);
	assert.deepEqual(selectPeaks(peaks, 1), selectPeaks(peaks, 1));
});

const META: HeroMeta = { west: 10.9, south: 47.35, east: 11.0, north: 47.45, minEle: 900, maxEle: 2900 };
const node = (id: number, lat: number, lon: number, extra: Partial<MapNode> = {}): MapNode =>
	({ id, lat, lon, demEle: 1000 + id, tags: { natural: 'peak', name: `P${id}` }, ...extra });
const hike = (slug: string, nodes: MapNode[], props: Record<string, unknown> = {}) =>
	({
		name: `Hike ${slug}`,
		route: `/projects/data-viz/hikes/${slug}`,
		properties: { filePath: `/_projects/data-viz/hikes/geojson/${slug}.json`, draft: false, dates: [], nodes, ...props }
	}) as unknown as Map;
const inside = (n: number) => Array.from({ length: n }, (_, i) => node(i, 47.36 + i * 0.01, 10.91 + i * 0.01));

test('buildCandidates keeps eligible hikes with their files and selected peaks', () => {
	const [c] = buildCandidates([hike('demo', inside(6))], { demo: META }, 5);
	assert.equal(c.slug, 'demo');
	assert.equal(c.heightmap, '/_projects/data-viz/hikes/hero/demo.webp');
	assert.equal(c.route, '/_projects/data-viz/hikes/geojson/demo.json');
	assert.deepEqual(c.bounds, { west: 10.9, south: 47.35, east: 11.0, north: 47.45 });
	assert.equal(c.peaks.length, 5);
	assert.equal(c.peaks[0].name, 'P5'); // highest demEle first
});

test('buildCandidates drops peaks outside the heightmap before counting', () => {
	const nodes = [...inside(4), node(9, 46.0, 10.95)];
	assert.deepEqual(buildCandidates([hike('demo', nodes)], { demo: META }, 5), []);
});

test('buildCandidates skips draft, hidden, non-peaks and missing heightmaps', () => {
	const saddles = inside(6).map((n) => ({ ...n, tags: { natural: 'saddle' } }));
	assert.deepEqual(buildCandidates([
		hike('draft', inside(6), { draft: true }),
		hike('hidden', inside(6), { hidden: true }),
		hike('saddles', saddles),
		hike('nometa', inside(6))
	], { draft: META, hidden: META, saddles: META }, 5), []);
});

test('buildCandidates finds the heightmap by sidecar stem when metaPath is set', () => {
	const h = hike('route-b', inside(5), { metaPath: '/_projects/data-viz/hikes/markdown/route-a.hike.json' });
	const [c] = buildCandidates([h], { 'route-a': META }, 5);
	assert.equal(c.heightmap, '/_projects/data-viz/hikes/hero/route-a.webp');
	assert.equal(c.slug, 'route-b');
});

test('buildCandidates falls back to tags.ele when demEle is missing', () => {
	const nodes = inside(5).map((n, i) => ({ ...n, demEle: undefined, tags: { ...n.tags, ele: String(2000 - i) } }));
	const [c] = buildCandidates([hike('demo', nodes)], { demo: META }, 5);
	assert.equal(c.peaks[0].name, 'P0');
	assert.equal(c.peaks[0].ele, 2000);
});

test('contourInterval aims for 20-30 lines', () => {
	assert.equal(contourInterval(900, 2900), 100);
	assert.equal(contourInterval(500, 800), 25);
	assert.equal(contourInterval(1000, 6000), 200);
});

test('assignLabels picks the permutation with the least total distance', () => {
	const labels = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
	const peaks = [{ x: 200, y: 50 }, { x: 0, y: 50 }, { x: 100, y: 50 }];
	assert.deepEqual(assignLabels(labels, peaks), [1, 2, 0]);
});

test('fitDistance keeps a sphere inside the tighter of the two view angles', () => {
	assert.ok(Math.abs(fitDistance(1, 90, 1, 1) - Math.SQRT2) < 1e-9);
	// Portrait: the horizontal angle is the tighter one.
	assert.ok(Math.abs(fitDistance(1, 90, 0.5, 1) - Math.sqrt(5)) < 1e-9);
	// Only the lower half of the screen is free: the vertical angle shrinks the same way.
	assert.ok(Math.abs(fitDistance(1, 90, 1, 0.5) - Math.sqrt(5)) < 1e-9);
});

test('smallestFit finds the threshold distance between the bounds', () => {
	const d = smallestFit((x) => x >= 3.7, 1, 10);
	assert.ok(d >= 3.7 && d - 3.7 < 1e-3);
});

test('smallestFit returns the upper bound when nothing smaller fits', () => {
	assert.equal(smallestFit(() => false, 1, 10), 10);
});

test('buildCandidates links the newest date that has a post', () => {
	const dates = [
		{ date: '2026-08-01', tags: [], people: [] },
		{ date: '2025-07-01', tags: [], people: [], path: '/x/2025-07-01-demo.md' },
		{ date: '2024-06-01', tags: [], people: [], path: '/x/2024-06-01-demo.md' }
	];
	const [c] = buildCandidates([hike('demo', inside(5), { dates })], { demo: META }, 5);
	assert.equal(c.name, 'Hike demo');
	assert.equal(c.href, '/hikes/2025-07-01-demo/');
});

test('buildCandidates falls back to the map page when the hike has no post', () => {
	const [c] = buildCandidates([hike('demo', inside(5), { dates: [{ date: '2026-08-01', tags: [], people: [] }] })], { demo: META }, 5);
	assert.equal(c.href, '/projects/data-viz/hikes/demo');
});

test('reassignLabels switches when the best pairing is clearly shorter', () => {
	const labels = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
	const peaks = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
	// Current pairing crosses (label 0 -> right peak); the straight one is far shorter.
	assert.deepEqual(reassignLabels(labels, peaks, [1, 0]), [0, 1]);
});

test('reassignLabels keeps an uncrossed pairing within the gain of the best', () => {
	// Labels on two rows: [0, 1] and [1, 0] are within 3% in length and neither crosses.
	const labels = [{ x: 0, y: 0 }, { x: 10, y: 400 }];
	const peaks = [{ x: 300, y: 200 }, { x: 310, y: 205 }];
	assert.equal(reassignLabels(labels, peaks, [0, 1]), null);
	assert.equal(reassignLabels(labels, peaks, [1, 0]), null);
});

test('reassignLabels untangles a crossing even when the gain is small', () => {
	const labels = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
	// The two pairings differ by under 0.1% in length, but [1, 0] crosses.
	const peaks = [{ x: 48, y: 500 }, { x: 52, y: 500 }];
	assert.deepEqual(reassignLabels(labels, peaks, [1, 0]), [0, 1]);
	assert.equal(reassignLabels(labels, peaks, [0, 1]), null);
});

test('candidatesScriptJson cannot close its <script> element', () => {
	const json = candidatesScriptJson([{ name: '</script><script>alert(1)</script>' } as never]);
	assert.ok(!json.includes('<'));
	assert.equal(JSON.parse(json)[0].name, '</script><script>alert(1)</script>');
});

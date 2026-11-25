// Run with: node_modules/.bin/jiti src/lib/hikes/hero-map.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, candidatesScriptJson, fitDistance, reassignLabels, selectPeaks, type HeroMeta, type HeroPeak } from './hero-map';
import type { Map, MapNode } from '../data/map-info';

const peak = (name: string, lat: number, lon: number, ele: number): HeroPeak => ({ name, lat, lon, ele });

test('selectPeaks starts at the highest and spreads out', () => {
	const peaks = [
		peak('low-west', 47.0, 11.00, 1500),
		peak('high-mid', 47.0, 11.05, 2500),
		peak('near-high', 47.0, 11.051, 2400),
		peak('east', 47.0, 11.11, 1800)
	];
	// east is 0.06° from high-mid, low-west 0.05°: east comes second, then low-west, never near-high.
	assert.deepEqual(selectPeaks(peaks, 3).map((p) => p.name), ['high-mid', 'east', 'low-west']);
});

const META: HeroMeta = { west: 10.9, south: 47.35, east: 11.0, north: 47.45, minEle: 900, maxEle: 2900 };
const node = (id: number, lat: number, lon: number, extra: Partial<MapNode> = {}): MapNode =>
	({ ref: `node/${id}`, lat, lon, demEle: 1000 + id, tags: { natural: 'peak', name: `P${id}` }, ...extra });
const hike = (slug: string, nodes: MapNode[], props: Record<string, unknown> = {}) =>
	({
		name: `Hike ${slug}`,
		route: `/projects/data-viz/hikes/${slug}`,
		properties: { filePath: `/_projects/data-viz/hikes/geojson/${slug}.json`, draft: false, dates: [], nodes, ...props }
	}) as unknown as Map;
const inside = (n: number) => Array.from({ length: n }, (_, i) => node(i, 47.36 + i * 0.01, 10.91 + i * 0.01));

test('buildCandidates keeps eligible hikes with their files, peaks and newest post', () => {
	const dates = [
		{ date: '2026-08-01', tags: [], people: [] },
		{ date: '2025-07-01', tags: [], people: [], path: '/x/2025-07-01-demo.md' },
		{ date: '2024-06-01', tags: [], people: [], path: '/x/2024-06-01-demo.md' }
	];
	const [c] = buildCandidates([hike('demo', inside(6), { dates })], { demo: META }, 5);
	assert.equal(c.heightmap, '/_projects/data-viz/hikes/hero/demo.webp');
	assert.equal(c.route, '/_projects/data-viz/hikes/geojson/demo.json');
	assert.equal(c.peaks.length, 5);
	assert.equal(c.peaks[0].name, 'P5'); // highest demEle first
	assert.equal(c.href, '/hikes/2025-07-01-demo/');
	// Without a post, the map page.
	assert.equal(buildCandidates([hike('demo', inside(5))], { demo: META }, 5)[0].href, '/projects/data-viz/hikes/demo');
	// The heightmap is found by sidecar stem when metaPath is set.
	const [b] = buildCandidates([hike('route-b', inside(5), { metaPath: '/_projects/data-viz/hikes/markdown/route-a.hike.json' })], { 'route-a': META }, 5);
	assert.equal(b.heightmap, '/_projects/data-viz/hikes/hero/route-a.webp');
	// tags.ele stands in for a missing demEle.
	const tagged = inside(5).map((n, i) => ({ ...n, demEle: undefined, tags: { ...n.tags, ele: String(2000 - i) } }));
	assert.equal(buildCandidates([hike('demo', tagged)], { demo: META }, 5)[0].peaks[0].ele, 2000);
	// Peaks outside the heightmap don't count; drafts, hidden hikes, non-peaks and missing heightmaps are skipped.
	const saddles = inside(6).map((n) => ({ ...n, tags: { natural: 'saddle' } }));
	assert.deepEqual(buildCandidates([
		hike('outside', [...inside(4), node(9, 46.0, 10.95)]),
		hike('draft', inside(6), { draft: true }),
		hike('hidden', inside(6), { hidden: true }),
		hike('saddles', saddles),
		hike('nometa', inside(6))
	], { outside: META, draft: META, hidden: META, saddles: META }, 5), []);
});

test('fitDistance keeps a sphere inside the tighter of the two view angles', () => {
	assert.ok(Math.abs(fitDistance(1, 90, 1, 1) - Math.SQRT2) < 1e-9);
	// Portrait: the horizontal angle is the tighter one.
	assert.ok(Math.abs(fitDistance(1, 90, 0.5, 1) - Math.sqrt(5)) < 1e-9);
	// Only the lower half of the screen is free: the vertical angle shrinks the same way.
	assert.ok(Math.abs(fitDistance(1, 90, 1, 0.5) - Math.sqrt(5)) < 1e-9);
});

test('reassignLabels switches for a clearly shorter or uncrossed pairing, else keeps the current one', () => {
	const labels = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
	// Current pairing crosses (label 0 -> right peak); the straight one is far shorter.
	assert.deepEqual(reassignLabels(labels, [{ x: 0, y: 50 }, { x: 100, y: 50 }], [1, 0]), [0, 1]);
	// The two pairings differ by under 0.1% in length, but [1, 0] crosses.
	const close = [{ x: 48, y: 500 }, { x: 52, y: 500 }];
	assert.deepEqual(reassignLabels(labels, close, [1, 0]), [0, 1]);
	assert.equal(reassignLabels(labels, close, [0, 1]), null);
	// Labels on two rows: [0, 1] and [1, 0] are within 3% in length and neither crosses.
	const rows = [{ x: 0, y: 0 }, { x: 10, y: 400 }];
	const peaks = [{ x: 300, y: 200 }, { x: 310, y: 205 }];
	assert.equal(reassignLabels(rows, peaks, [0, 1]), null);
	assert.equal(reassignLabels(rows, peaks, [1, 0]), null);
});

test('candidatesScriptJson cannot close its <script> element', () => {
	const json = candidatesScriptJson([{ name: '</script><script>alert(1)</script>' } as never]);
	assert.ok(!json.includes('<'));
	assert.equal(JSON.parse(json)[0].name, '</script><script>alert(1)</script>');
});

// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/layout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgePath, layoutTimeline } from './layout';
import type { TreeNode, TreeTimeline } from './model';

const path = (a: string) => `${a}.md`;
const eras = (...keys: string[]) => keys.map((key, i) => ({ key, from: 1970 + i * 10, to: 1979 + i * 10 }));

function n(anchor: string, era: number, extra: Partial<TreeNode> = {}): TreeNode {
	return { anchor, titles: { en: anchor }, href: null, comingSoon: true, year: 1970 + era * 10, era, row: null, ...extra };
}

function tl(eraKeys: string[], nodes: TreeNode[], edges: [string, string][] = []): TreeTimeline {
	return { key: 't', eras: eras(...eraKeys), nodes, edges: edges.map(([from, to]) => ({ from, to })) };
}

const byAnchor = (l: ReturnType<typeof layoutTimeline>) => Object.fromEntries(l.nodes.map((x) => [x.anchor, x]));

test('one node per era', () => {
	const l = layoutTimeline(tl(['a', 'b'], [n('n1', 0), n('n2', 1)], [['n1', 'n2']]), path);
	const m = byAnchor(l);
	assert.deepEqual([m.n1.col, m.n2.col], [0, 1]);
	assert.deepEqual([m.n1.gridRow, m.n2.gridRow], [0, 0]);
	assert.deepEqual(l.eras, [{ key: 'a', colStart: 0, colSpan: 1 }, { key: 'b', colStart: 1, colSpan: 1 }]);
	assert.equal(l.cols, 2);
	assert.equal(l.rows, 1);
});

test('same-era chain splits into sub-columns', () => {
	const l = layoutTimeline(tl(['a', 'b'], [n('x', 0), n('y', 0), n('z', 0), n('w', 1)], [['x', 'y'], ['y', 'z']]), path);
	const m = byAnchor(l);
	assert.deepEqual([m.x.col, m.y.col, m.z.col, m.w.col], [0, 1, 2, 3]);
	assert.equal(l.eras[0].colSpan, 3);
	assert.equal(l.eras[1].colStart, 3);
});

test('empty era keeps one column', () => {
	const l = layoutTimeline(tl(['a', 'b', 'c'], [n('p', 0), n('q', 2)]), path);
	assert.deepEqual(l.eras[1], { key: 'b', colStart: 1, colSpan: 1 });
	assert.equal(l.cols, 3);
});

test('barycenter follows predecessor', () => {
	const l = layoutTimeline(tl(['a', 'b'], [n('p', 0, { row: 3 }), n('q', 0), n('r', 1)], [['p', 'r']]), path);
	assert.equal(byAnchor(l).r.gridRow, 3);
	assert.equal(l.rows, 4);
});

test('pinned row collision throws', () => {
	assert.throws(() => layoutTimeline(tl(['a'], [n('p', 0, { row: 1 }), n('q', 0, { row: 1 })]), path), /p\.md.*q\.md|q\.md.*p\.md/);
});

test('deterministic tie order', () => {
	const l = layoutTimeline(tl(['a'], [n('late', 0, { year: 2000 }), n('early', 0, { year: 1990 })]), path);
	assert.equal(byAnchor(l).early.gridRow, 0);
	assert.equal(byAnchor(l).late.gridRow, 1);
});

test('intro node (null year) sorts first', () => {
	const l = layoutTimeline(tl(['a'], [n('paper', 0, { year: 1975 }), n('intro', 0, { year: null })]), path);
	assert.equal(byAnchor(l).intro.gridRow, 0);
});

test('no nodes gives zero rows', () => {
	const l = layoutTimeline(tl(['a'], []), path);
	assert.equal(l.rows, 0);
	assert.equal(l.cols, 1);
});

test('a long arrow routes around the cards it passes', () => {
	const l = layoutTimeline(
		tl(['a', 'b', 'c', 'd'], [n('basics', 0), n('vol', 1), n('hyper', 2), n('gpu', 3)], [['basics', 'vol'], ['basics', 'hyper'], ['basics', 'gpu']]),
		path
	);
	const m = byAnchor(l);
	const edge = (from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)!;
	assert.deepEqual(edge('basics', 'vol').via, []);
	const toGpu = edge('basics', 'gpu').via;
	assert.deepEqual(toGpu.map((v) => v.col), [1, 2]);
	assert.notEqual(toGpu[0].row, m.vol.gridRow);
	assert.notEqual(toGpu[1].row, m.hyper.gridRow);
	// Arrows from one post share their lane through a column.
	assert.deepEqual(edge('basics', 'hyper').via, [toGpu[0]]);
	assert.ok(l.rows > Math.max(...toGpu.map((v) => v.row)));
});

test('edgePath through waypoints', () => {
	assert.equal(
		edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 400, y: 0, w: 100, h: 40 }, [{ x: 200, y: 80, w: 100, h: 40 }]),
		'M 100 20 C 150 20, 150 100, 200 100 L 300 100 C 350 100, 350 20, 400 20'
	);
});

test('edgePath', () => {
	assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 200, y: 80, w: 100, h: 40 }), 'M 100 20 C 150 20, 150 100, 200 100');
});

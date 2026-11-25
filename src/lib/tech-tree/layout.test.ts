// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/layout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeline } from './layout';
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

test('same-era chain splits into sub-columns', () => {
	const l = layoutTimeline(tl(['a', 'b'], [n('x', 0), n('y', 0), n('z', 0), n('w', 1)], [['x', 'y'], ['y', 'z']]), path);
	const m = byAnchor(l);
	assert.deepEqual([m.x.col, m.y.col, m.z.col, m.w.col], [0, 1, 2, 3]);
	assert.equal(l.eras[0].colSpan, 3);
	assert.equal(l.eras[1].colStart, 3);
});

test('barycenter follows predecessor', () => {
	const l = layoutTimeline(tl(['a', 'b'], [n('p', 0, { row: 3 }), n('q', 0), n('r', 1)], [['p', 'r']]), path);
	assert.equal(byAnchor(l).r.gridRow, 3);
	assert.equal(l.rows, 4);
});

test('pinned row collision throws', () => {
	assert.throws(() => layoutTimeline(tl(['a'], [n('p', 0, { row: 1 }), n('q', 0, { row: 1 })]), path), /p\.md.*q\.md|q\.md.*p\.md/);
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

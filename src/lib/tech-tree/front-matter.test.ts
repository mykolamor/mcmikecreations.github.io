// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/front-matter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTechTree } from './front-matter';
import { buildBlogIndex } from '$lib/blog/blog-index.server';

test('missing block is null', () => {
	assert.equal(parseTechTree(undefined, 'a.md'), null);
});

test('full block parses', () => {
	const block = { timelines: ['qp'], year: 2011, buildsOn: ['x'], row: 2, intro: true };
	assert.deepEqual(parseTechTree(block, 'a.md'), block);
});

test('defaults', () => {
	assert.deepEqual(parseTechTree({ timelines: ['qp'], year: 1970 }, 'a.md'), {
		timelines: ['qp'],
		year: 1970,
		buildsOn: [],
		row: null,
		intro: false
	});
});

test('invalid shapes throw with the file name', () => {
	const ok = { timelines: ['qp'], year: 2011 };
	const bad: unknown[] = [
		'x',
		{ year: 2011 },
		{ ...ok, timelines: [] },
		{ ...ok, timelines: ['qp', 'qp'] },
		{ ...ok, timelines: 'qp' },
		{ ...ok, year: '2011' },
		{ ...ok, year: 2011.5 },
		{ ...ok, buildsOn: 'x' },
		{ ...ok, buildsOn: ['x', 'x'] },
		{ ...ok, row: -1 },
		{ ...ok, row: 1.5 },
		{ ...ok, intro: 'yes' },
		{ ...ok, rows: 1 }
	];
	for (const raw of bad) {
		assert.throws(() => parseTechTree(raw, 'a.md'), /a\.md/, JSON.stringify(raw));
	}
});

test('blog index carries techTree', () => {
	const { posts } = buildBlogIndex({
		'2026-01-01-a.md': '---\ntitle: A\ndate: 2026-01-01\ntags: [Databases]\ntechTree:\n  timelines: [qp]\n  year: 1990\n---\nbody',
		'2026-01-02-b.md': '---\ntitle: B\ndate: 2026-01-02\n---\nbody'
	});
	const a = posts.find((p) => p.anchor === '2026-01-01-a')!;
	const b = posts.find((p) => p.anchor === '2026-01-02-b')!;
	assert.deepEqual(a.techTree, { timelines: ['qp'], year: 1990, buildsOn: [], row: null, intro: false });
	assert.equal(b.techTree, null);
});

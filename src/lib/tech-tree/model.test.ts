// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTechTree, type TreePostInput } from './model';
import type { TechTreeEntry } from './front-matter';
import type { TimelineDef } from './timelines';

const DEFS: TimelineDef[] = [
	{ key: 'qp', eras: [{ key: 'a', from: 1970, to: 1989 }, { key: 'b', from: 1990, to: null }] },
	{ key: 'st', eras: [{ key: 's', from: 1970, to: null }] }
];

function post(
	anchor: string,
	techTree: Partial<TechTreeEntry> | null,
	{ draft = false, tags = ['Databases'] }: { draft?: boolean; tags?: string[] } = {}
): TreePostInput {
	return {
		anchor,
		path: `${anchor}.md`,
		draft,
		tags,
		titles: { en: anchor },
		techTree: techTree && { timelines: ['qp'], year: 1980, buildsOn: [], row: null, intro: false, ...techTree }
	};
}

const timeline = (tree: ReturnType<typeof buildTechTree>, key: string) => tree.timelines.find((t) => t.key === key)!;
const node = (tree: ReturnType<typeof buildTechTree>, key: string, anchor: string) =>
	timeline(tree, key).nodes.find((n) => n.anchor === anchor)!;

test('published and draft nodes', () => {
	const tree = buildTechTree([post('p1', {}), post('d1', {}, { draft: true })], DEFS);
	assert.equal(node(tree, 'qp', 'p1').href, '/blog/p1/');
	assert.equal(node(tree, 'qp', 'p1').comingSoon, false);
	assert.equal(node(tree, 'qp', 'd1').href, null);
	assert.equal(node(tree, 'qp', 'd1').comingSoon, true);
});

test('era boundaries are inclusive and last era may be open', () => {
	const tree = buildTechTree([post('p89', { year: 1989 }), post('p90', { year: 1990 }), post('p99', { year: 2099 })], DEFS);
	assert.equal(node(tree, 'qp', 'p89').era, 0);
	assert.equal(node(tree, 'qp', 'p90').era, 1);
	assert.equal(node(tree, 'qp', 'p99').era, 1);
	const closed: TimelineDef[] = [{ key: 'qp', eras: [{ key: 'a', from: 1970, to: 1989 }] }];
	assert.throws(() => buildTechTree([post('p1', { year: 1990 })], closed), /p1\.md/);
});

test('buildsOn across timelines draws only shared arrows', () => {
	const tree = buildTechTree(
		[
			post('x', { timelines: ['qp', 'st'] }),
			post('y', { timelines: ['qp'], buildsOn: ['x'] }),
			post('z', { timelines: ['st'], buildsOn: ['y'] })
		],
		DEFS
	);
	assert.deepEqual(timeline(tree, 'qp').edges, [{ from: 'x', to: 'y' }]);
	assert.deepEqual(timeline(tree, 'st').nodes.map((n) => n.anchor).sort(), ['x', 'z']);
	assert.deepEqual(timeline(tree, 'st').edges, []);
});

test('bad tree data throws naming the post', () => {
	const cases: [TreePostInput[], RegExp][] = [
		[[post('notag', {}, { tags: ['GPU'] })], /notag\.md/],
		[[post('unk', { timelines: ['nope'] })], /unk\.md/],
		[[post('miss', { buildsOn: ['ghost'] })], /miss\.md/],
		[[post('plain', null), post('needs', { buildsOn: ['plain'] })], /needs\.md/],
		[[post('late', { year: 1995 }), post('early', { year: 1975, buildsOn: ['late'] })], /early\.md/],
		[[post('x', { buildsOn: ['y'] }), post('y', { buildsOn: ['x'] })], /[xy]\.md/]
	];
	for (const [posts, re] of cases) assert.throws(() => buildTechTree(posts, DEFS), re, re.source);
	// A dependency within one era may point to a later year.
	assert.doesNotThrow(() => buildTechTree([post('x', { year: 1975 }), post('y', { year: 1971, buildsOn: ['x'] })], DEFS));
});

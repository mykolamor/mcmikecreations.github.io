// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/posts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildBlogIndex } from '$lib/blog/blog-index.server';
import { techTreeLayouts } from './tree.server';

const BLOG = path.resolve(import.meta.dirname ?? __dirname, '../../../static/_blog');

test("the blog's tech tree data builds", () => {
	const files = Object.fromEntries(
		fs
			.readdirSync(BLOG)
			.filter((f) => f.endsWith('.md'))
			.map((f) => [f, fs.readFileSync(path.join(BLOG, f), 'utf-8')])
	);
	assert.doesNotThrow(() => techTreeLayouts(buildBlogIndex(files)));
});

const POST = '---\ntitle: Basics\ndate: 2026-01-01\ntags: [Databases]\ntechTree:\n  timelines: [query-processing]\n  year: 1970\n---\nbody';

test('a translation gives its title, or none to fall back to English', () => {
	const index = buildBlogIndex({
		'2026-01-01-a.md': POST,
		'2026-01-01-a.de.md': '---\ntitle: Grundlagen\n---\nText',
		'2026-01-01-a.uk.md': '---\ndescription: Nur Text\n---\nText'
	});
	const [tl] = techTreeLayouts(index);
	assert.deepEqual(tl.nodes[0].titles, { en: 'Basics', de: 'Grundlagen' });
});

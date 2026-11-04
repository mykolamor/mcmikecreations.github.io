import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHike, createPost } from './create';
import { listHikes } from './hikes-index';
import { postPath, sidecarPath } from './doc';
import { isTranslationFile } from './translations';
import { makeTempRepo } from './test-repo';
import { repoPaths } from './paths';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { editSidecar } from './sidecar-file';
import { assembleHikes } from '$lib/data/hikes-core.js';

const R = '/projects/data-viz/hikes/';
const readJson = (root: string) => JSON.parse(readFileSync(repoPaths(root).hikesJson, 'utf8')) as any[];

test('postCount counts hike posts only', () => {
	const root = makeTempRepo();
	const dir = repoPaths(root).markdown;
	const expected = readdirSync(dir).filter((f: string) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f) && !isTranslationFile(f)).length;
	assert.ok(expected > 50);
	assert.equal(listHikes(root).postCount, expected);
});

test('createPost moves the hikes.json date into front matter', () => {
	const root = makeTempRepo();
	const hp = repoPaths(root).hikesJson;
	const real = readFileSync(hp, 'utf8');
	// give wendelstein's 2024-01-03 entry tags/people through a minimal edit
	const wi = readJson(root).findIndex((e) => e.route === R + 'wendelstein');
	const wj = readJson(root)[wi].properties.dates.findIndex((x: any) => x.date === '2024-01-03');
	writeFileSync(
		hp,
		editSidecar(real, [
			{ path: [wi, 'properties', 'dates', wj, 'tags'], value: ['Web'] },
			{ path: [wi, 'properties', 'dates', wj, 'people'], value: ['A'] }
		])
	);
	createPost(root, { slug: 'wendelstein', date: '2024-01-03' });
	const { doc } = readFrontmatterDoc(readFileSync(postPath(root, 'wendelstein', '2024-01-03'), 'utf8'));
	assert.deepEqual(doc.toJS(), { tags: ['Web'], people: ['A'] });
	const w2 = readJson(root).find((e) => e.route === R + 'wendelstein');
	assert.deepEqual(w2.properties.dates, [{ date: '2023-09-02' }]);
	assert.equal(w2.properties.ascent, 990);
});

test('hikes.json edits are byte-minimal (multi-date and last-date cases)', () => {
	const root = makeTempRepo();
	const hp = repoPaths(root).hikesJson;
	const real = readFileSync(hp, 'utf8');
	// multi-date: only the one date element disappears
	const el = '        {\n          "date": "2024-01-03"\n        },\n';
	assert.equal(real.split(el).length, 2);
	createPost(root, { slug: 'wendelstein', date: '2024-01-03' });
	assert.equal(readFileSync(hp, 'utf8'), real.replace(el, ''));
	// last date of a dates-only-plus-metrics route: the whole entry disappears
	const afterFirst = readFileSync(hp, 'utf8');
	const start = afterFirst.indexOf('  {\n');
	const end = afterFirst.indexOf('\n  },\n') + '\n  },\n'.length;
	assert.ok(afterFirst.slice(start, end).includes(R + 'seekarkreuz'));
	createPost(root, { slug: 'seekarkreuz', date: '2024-02-18' });
	assert.equal(readFileSync(hp, 'utf8'), afterFirst.slice(0, start) + afterFirst.slice(end));
	// a dates-only route
	assert.ok(readJson(root).some((e) => e.route === R + 'furnas'));
	createPost(root, { slug: 'furnas', date: '2024-03-09' });
	assert.ok(!readJson(root).some((e) => e.route === R + 'furnas'));
	assert.equal(readFileSync(postPath(root, 'furnas', '2024-03-09'), 'utf8'), '---\n---\n');
});

test('last date: only metrics move; draft stays and the entry is kept with dates []', () => {
	const root = makeTempRepo();
	const hp = repoPaths(root).hikesJson;
	const i = readJson(root).findIndex((e) => e.route === R + 'bad_tolz_lenggries');
	writeFileSync(
		hp,
		editSidecar(readFileSync(hp, 'utf8'), [
			{ path: [i, 'properties', 'draft'], value: true },
			{ path: [i, 'properties', 'ascent'], value: 500 },
			{ path: [i, 'properties', 'hidden'], value: true }
		])
	);
	createPost(root, { slug: 'bad_tolz_lenggries', date: '2024-03-31' });
	const fm = readFrontmatterDoc(readFileSync(postPath(root, 'bad_tolz_lenggries', '2024-03-31'), 'utf8')).doc.toJS();
	assert.deepEqual(fm, { ascent: 500 });
	const entry = readJson(root).find((e) => e.route === R + 'bad_tolz_lenggries');
	assert.deepEqual(entry.properties, { draft: true, hidden: true, dates: [] });
	// the build path accepts an empty dates list when a post supplies the date
	const hikes = assembleHikes({
		slugs: ['bad_tolz_lenggries'],
		posts: [{ file: '2024-03-31-bad_tolz_lenggries.md', path: '/x', frontmatter: fm }],
		overrides: [entry],
		getHikeMeta: () => JSON.parse(readFileSync(sidecarPath(root, 'bad_tolz_lenggries'), 'utf8')),
		hasGpxFile: () => false
	});
	assert.equal(hikes[0].properties.dates.length, 1);
	assert.equal(hikes[0].properties.draft, true);
});

test('createPost rejects an existing post', () => {
	const root = makeTempRepo();
	const post = listHikes(root).hikes.find((h) => h.posts.length)!;
	assert.throws(() => createPost(root, { slug: post.slug, date: post.posts[0].date }), /already exists/);
	assert.throws(() => createPost(root, { slug: 'nosuchhike', date: '2030-01-01' }), /No sidecar/);
});

test('createHike rejects an existing slug and unsafe slugs', () => {
	const root = makeTempRepo();
	assert.throws(() => createHike(root, { slug: 'wendelstein', name: 'X', date: '2030-01-01' }), /already exists/);
	for (const slug of ['../x', 'A b', '', 'a/b'])
		assert.throws(() => createHike(root, { slug, name: 'X', date: '2030-01-01' }), /Invalid slug/);
	const r = createHike(root, { slug: 'new_one', name: 'New One', date: '2030-01-01' });
	assert.deepEqual(r, { slug: 'new_one', date: '2030-01-01' });
	assert.deepEqual(JSON.parse(readFileSync(sidecarPath(root, 'new_one'), 'utf8')), { name: 'New One', height: 512, checkpoints: [] });
	assert.equal(readFileSync(postPath(root, 'new_one', '2030-01-01'), 'utf8'), '---\n---\n');
	assert.ok(existsSync(path.join(repoPaths(root).markdown, '2030-01-01-new_one.md')));
});

test('listHikes marks hikes with no post', () => {
	const root = makeTempRepo();
	const { hikes } = listHikes(root);
	const sk = hikes.find((h) => h.slug === 'seekarkreuz')!;
	assert.ok(!sk.posts.some((p) => p.date === '2024-02-18'));
	assert.deepEqual(sk.postlessDates, ['2024-02-18']);
	createPost(root, { slug: 'seekarkreuz', date: '2024-02-18' });
	const sk2 = listHikes(root).hikes.find((h) => h.slug === 'seekarkreuz')!;
	assert.equal(sk2.posts.length, sk.posts.length + 1);
	assert.deepEqual(sk2.postlessDates, []);
});

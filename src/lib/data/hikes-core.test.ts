// Run with: node_modules/.bin/jiti src/lib/data/hikes-core.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleHikes, defaultMetaPath, metaFolder, resolveHikeForDate, resolveHikeForPost } from './hikes-core.js';
import { readSidecarTexts } from '../hikes/facts.server';
import type { HikeMeta, Map } from './map-info';

const SIDECAR = {
	name: { en: 'X', de: 'Y' },
	description: { en: 'About X.', de: 'Über X.' },
	image: '/x.jpg',
	origin: { lat: 47, lon: 11 },
	height: 512,
	checkpoints: [[11, 47]]
};
const POST_FILE = '2026-07-19-x.md';
const POST_PATH = `${metaFolder}/${POST_FILE}`;

/** The site's assembly, fed like `hikes-db` feeds it: every sidecar through `readSidecarTexts`. */
function siteHikes(sidecar: unknown) {
	const meta = readSidecarTexts(sidecar as HikeMeta, 'x.hike.json');
	const getHikeMeta = (p: string) => (p === defaultMetaPath('x') ? meta : undefined);
	const hikes = assembleHikes({
		slugs: ['x'],
		posts: [{ file: POST_FILE, path: POST_PATH, frontmatter: {} }],
		overrides: [],
		getHikeMeta,
		hasGpxFile: () => false
	}) as Map[];
	return { hikes, getHikeMeta };
}

test('a translated sidecar name renders as its English text everywhere', () => {
	const { hikes, getHikeMeta } = siteHikes(SIDECAR);
	const [hike] = hikes;
	const [date] = hike.properties.dates;

	// The hike object: English strings, the translations alongside.
	assert.equal(hike.name, 'X');
	assert.equal(hike.description, 'About X.');
	assert.deepEqual(hike.nameText, { en: 'X', de: 'Y' });
	assert.deepEqual(hike.descriptionText, { en: 'About X.', de: 'Über X.' });

	// getAllPosts and the post page (title, JSON-LD `placeName`): the hike as the post sees it.
	const forPost = resolveHikeForPost(hike, date, {}, getHikeMeta).hike;
	assert.equal(date.title ?? forPost.name, 'X');
	assert.equal(forPost.description, 'About X.');

	// The search index entry: the hike as its date sees it.
	const forDate = resolveHikeForDate(hike, date, getHikeMeta);
	assert.equal(forDate.name, 'X');
	assert.equal(forDate.description, 'About X.');

	// The Node scripts read the same files from disk: see scripts/crm/server/problems.test.ts.
});

test('an unknown language in a sidecar name fails the build', () => {
	assert.throws(() => siteHikes({ ...SIDECAR, name: { en: 'X', fr: 'Z' } }), /x\.hike\.json: name: unknown language "fr" \(en, de, uk\)/);
	assert.throws(() => siteHikes({ ...SIDECAR, description: { de: 'Über X.' } }), /x\.hike\.json: description: text needs a non-empty `en`/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlace, loadPlace, placeClientDoc, savePlaceOps } from './place-doc';
import { PLACE_FIELDS } from '../shared/fields';
import { listHikes } from './hikes-index';
import { makeTempRepo } from './test-repo';
import { repoPaths } from './paths';
import { ApiError } from './errors';

const RAW = '---\ntitle: Knorrhütte\ndescription: DAV hut.\ntags: [Hut, DAV]\nimages:\n  a.jpg: {w: 1}\n---\nBody\n';

function tmpPlaces(raw = RAW) {
	const root = mkdtempSync(join(tmpdir(), 'crm-place-'));
	const dir = repoPaths(root).places;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'knorrhuette.md'), raw);
	return { root, file: join(dir, 'knorrhuette.md') };
}

test('place doc fields round-trip and clearing title or description is refused', () => {
	assert.deepEqual(PLACE_FIELDS.map((f) => [f.id, f.file, f.path.join('.'), f.kind, !!f.required]), [
		['place.title', 'place', 'title', 'text', true],
		['place.description', 'place', 'description', 'textarea', true],
		['place.tags', 'place', 'tags', 'chips', false],
		['place.aliases', 'place', 'aliases', 'chips', false]
	]);
	const { root, file } = tmpPlaces();
	const d = loadPlace(root, 'knorrhuette');
	const c = placeClientDoc(d);
	assert.equal(c.kind, 'place');
	assert.equal(c.slug, 'knorrhuette');
	assert.equal(c.body, 'Body\n');
	assert.deepEqual(c.fields, { 'place.title': 'Knorrhütte', 'place.description': 'DAV hut.', 'place.tags': ['Hut', 'DAV'] });
	// Writing back the values read is a byte no-op.
	const same = savePlaceOps(root, 'knorrhuette', d.version, Object.entries(c.fields).map(([field, value]) => ({ field, value })));
	assert.equal(same.ok, true);
	assert.equal(readFileSync(file, 'utf8'), RAW);
	assert.equal(same.doc.version, d.version);
	// Required fields can't be cleared; nothing is written.
	for (const op of [{ field: 'place.description', value: '' }, { field: 'place.description', value: null }, { field: 'place.title', value: '' }])
		assert.throws(() => savePlaceOps(root, 'knorrhuette', d.version, [op]), (e) => e instanceof ApiError && e.status === 400, JSON.stringify(op));
	assert.equal(readFileSync(file, 'utf8'), RAW);
	// Optional ones: an empty list removes the key.
	const r = savePlaceOps(root, 'knorrhuette', d.version, [
		{ field: 'place.tags', value: [] },
		{ field: 'place.aliases', value: ['Knorr hut'] }
	]);
	assert.equal(r.ok, true);
	assert.equal(readFileSync(file, 'utf8'), RAW.replace('tags: [Hut, DAV]\n', '').replace('images:', 'aliases:\n  - Knorr hut\nimages:'));
	assert.deepEqual(r.doc.fields, { 'place.title': 'Knorrhütte', 'place.description': 'DAV hut.', 'place.aliases': ['Knorr hut'] });
	assert.equal(r.doc.version, loadPlace(root, 'knorrhuette').version);
	// Stale base: nothing written, the current doc comes back.
	const stale = savePlaceOps(root, 'knorrhuette', d.version, [{ field: 'place.title', value: 'X' }]);
	assert.equal(stale.ok, false);
	assert.equal(stale.doc.fields['place.title'], 'Knorrhütte');
	// Post fields and mirrors don't exist on a place doc.
	const v = loadPlace(root, 'knorrhuette').version;
	for (const op of [{ field: 'post.title', value: 'X' }, { field: 'sidecar.name', value: 'X' }, { kind: 'mirrors' as const, rows: [] }])
		assert.throws(() => savePlaceOps(root, 'knorrhuette', v, [op]), (e) => e instanceof ApiError && e.status === 400);
	assert.throws(() => loadPlace(root, 'nope'), (e) => e instanceof ApiError && e.status === 404);
});

test('createPlace refuses an existing slug, a bad slug and a missing title or description', () => {
	const { root } = tmpPlaces();
	assert.deepEqual(createPlace(root, 'zugspitz-platt', ' Zugspitzplatt ', ' Karst plateau. '), { slug: 'zugspitz-platt' });
	assert.equal(readFileSync(join(repoPaths(root).places, 'zugspitz-platt.md'), 'utf8'), '---\ntitle: Zugspitzplatt\ndescription: Karst plateau.\n---\n');
	assert.equal(placeClientDoc(loadPlace(root, 'zugspitz-platt')).body, '');
	createPlace(root, 'colon', 'Hut: upper', 'Note: quoted');
	assert.deepEqual(placeClientDoc(loadPlace(root, 'colon')).fields, { 'place.title': 'Hut: upper', 'place.description': 'Note: quoted' });
	assert.throws(() => createPlace(root, 'knorrhuette', 'Again', 'D'), (e) => e instanceof ApiError && e.status === 409);
	assert.equal(readFileSync(join(repoPaths(root).places, 'knorrhuette.md'), 'utf8'), RAW);
	for (const slug of ['../x', 'Knorr', 'a--b', '', 'x_'])
		assert.throws(() => createPlace(root, slug, 'T', 'D'), (e) => e instanceof ApiError && e.status === 400, slug);
	for (const [t, d] of [['  ', 'D'], ['T', ''], ['T', ' \n ']])
		assert.throws(() => createPlace(root, 'fine', t, d), (e) => e instanceof ApiError && e.status === 400, JSON.stringify([t, d]));
	assert.equal(existsSync(join(repoPaths(root).places, 'fine.md')), false);
	// A repo without a places folder gets one.
	const bare = mkdtempSync(join(tmpdir(), 'crm-place-'));
	createPlace(bare, 'first', 'First', 'D');
	assert.ok(existsSync(join(repoPaths(bare).places, 'first.md')));
});

test('listHikes lists place docs without counting them', () => {
	const root = makeTempRepo();
	const before = listHikes(root);
	createPlace(root, 'aaa_new_place', 'Zzz last by title', 'D');
	const after = listHikes(root);
	assert.equal(after.postCount, before.postCount);
	assert.equal(after.hikes.length, before.hikes.length);
	assert.equal(after.places.length, before.places.length + 1);
	assert.ok(after.places.some((p) => p.slug === 'knorrhuette' && p.title === 'Knorrhütte'));
	const titles = after.places.map((p) => p.title);
	assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
	const last = after.places.at(-1)!;
	assert.deepEqual({ slug: last.slug, title: last.title }, { slug: 'aaa_new_place', title: 'Zzz last by title' });
});

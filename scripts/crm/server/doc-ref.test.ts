import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docFile, lockKey, ownFolder, refFromQuery } from './doc-ref';
import { withDocLock } from './doc-lock';
import { loadDoc, saveOps } from './doc';
import { loadPlace, savePlaceOps } from './place-doc';
import { ApiError } from './errors';
import { refParams } from '../web/doc-session';

const q = (o: Record<string, string>) => new URLSearchParams(o);
const is400 = (e: unknown) => e instanceof ApiError && e.status === 400;

test('refFromQuery maps place/post/hike and rejects bad slugs', () => {
	assert.deepEqual(refFromQuery(q({ place: 'obere_firstalm' })), { kind: 'place', slug: 'obere_firstalm' });
	assert.deepEqual(refFromQuery(q({ place: 'zugspitz-platt' })), { kind: 'place', slug: 'zugspitz-platt' });
	assert.deepEqual(refFromQuery(q({ slug: 'foo', date: '2024-01-01' })), { kind: 'post', slug: 'foo', date: '2024-01-01' });
	assert.deepEqual(refFromQuery(q({ slug: 'foo' })), { kind: 'hike', slug: 'foo' });
	assert.deepEqual(refFromQuery(q({ slug: 'foo', date: '' })), { kind: 'hike', slug: 'foo' });
	for (const bad of <Record<string, string>[]>[{}, { slug: '../x' }, { slug: 'Foo' }, { slug: 'foo', date: '2024-02-30' }, { place: '' }, { place: 'a--b' }, { place: '../x' }, { place: 'Knorr' }, { place: 'x_' }])
		assert.throws(() => refFromQuery(q(bad)), is400, JSON.stringify(bad));
	assert.equal(lockKey({ kind: 'post', slug: 'foo', date: '2024-01-01' }), 'post:foo');
	assert.equal(lockKey({ kind: 'hike', slug: 'foo' }), 'post:foo');
	assert.equal(lockKey({ kind: 'place', slug: 'foo' }), 'place:foo');
	assert.equal(docFile('/r', { kind: 'hike', slug: 'foo' }), null);
	assert.equal(docFile('/r', { kind: 'post', slug: 'foo', date: '2024-01-01' }), '/r/static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md');
	assert.equal(docFile('/r', { kind: 'place', slug: 'foo' }), '/r/static/_projects/data-viz/hikes/places/foo.md');
	assert.equal(ownFolder({ kind: 'post', slug: 'foo', date: '2024-01-01' }), '/images/projects/data-viz/hikes/stories/foo/');
	assert.equal(ownFolder({ kind: 'place', slug: 'foo' }), '/images/projects/data-viz/hikes/places/foo/');
});

test('post and place refs with one slug lock and load independently', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-ref-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	const places = join(root, 'static/_projects/data-viz/hikes/places');
	mkdirSync(md, { recursive: true });
	mkdirSync(places, { recursive: true });
	writeFileSync(join(md, 'knorrhuette.hike.json'), '{\n  "name": "Knorr"\n}\n');
	writeFileSync(join(md, '2024-01-01-knorrhuette.md'), '---\ntitle: Hike\n---\nHike body\n');
	writeFileSync(join(places, 'knorrhuette.md'), '---\ntitle: Knorrhütte\n---\nPlace body\n');
	const post = { kind: 'post' as const, slug: 'knorrhuette', date: '2024-01-01' };
	const place = { kind: 'place' as const, slug: 'knorrhuette' };

	// Locks: a held post lock blocks a second post job, not a place job.
	const order: string[] = [];
	let release!: () => void;
	const held = withDocLock(lockKey(post), () => new Promise<void>((r) => (release = () => (order.push('post 1 done'), r()))));
	const post2 = withDocLock(lockKey({ kind: 'hike', slug: 'knorrhuette' }), () => void order.push('post 2'));
	await withDocLock(lockKey(place), () => void order.push('place'));
	assert.deepEqual(order, ['place']);
	release();
	await Promise.all([held, post2]);
	assert.deepEqual(order, ['place', 'post 1 done', 'post 2']);

	// Load and save: versions are per doc; a place write leaves the post alone and vice versa.
	const p0 = loadDoc(root, post.slug, post.date);
	const pl0 = loadPlace(root, place.slug);
	assert.notEqual(p0.version, pl0.version);
	assert.equal(savePlaceOps(root, place.slug, pl0.version, [{ kind: 'body', text: 'New place body\n' }]).ok, true);
	assert.equal(loadDoc(root, post.slug, post.date).version, p0.version);
	assert.equal(saveOps(root, post.slug, post.date, p0.version, [{ kind: 'body', text: 'New hike body\n' }]).ok, true);
	assert.equal(readFileSync(join(places, 'knorrhuette.md'), 'utf8'), '---\ntitle: Knorrhütte\n---\nNew place body\n');
	assert.equal(readFileSync(join(md, '2024-01-01-knorrhuette.md'), 'utf8'), '---\ntitle: Hike\n---\nNew hike body\n');
	assert.notEqual(loadPlace(root, place.slug).version, pl0.version);
});

test('a translation ref round-trips through the query', () => {
	const post = { kind: 'translation' as const, source: { kind: 'post' as const, slug: 'x', date: '2026-01-01' }, lang: 'de' as const };
	const place = { kind: 'translation' as const, source: { kind: 'place' as const, slug: 'y' }, lang: 'de' as const };
	assert.deepEqual(refFromQuery(q({ slug: 'x', date: '2026-01-01', lang: 'de' })), post);
	assert.deepEqual(refFromQuery(q({ place: 'y', lang: 'de' })), place);
	for (const ref of [post, place]) assert.deepEqual(refFromQuery(q(refParams(ref))), ref);
	assert.deepEqual(refParams(post), { slug: 'x', date: '2026-01-01', lang: 'de' });
	assert.deepEqual(refParams(place), { place: 'y', lang: 'de' });
	// The file beside its source; the source's lock and media folder.
	assert.equal(docFile('/r', post), '/r/static/_projects/data-viz/hikes/markdown/2026-01-01-x.de.md');
	assert.equal(docFile('/r', place), '/r/static/_projects/data-viz/hikes/places/y.de.md');
	assert.equal(lockKey(post), 'post:x');
	assert.equal(lockKey(place), 'place:y');
	assert.equal(ownFolder(post), '/images/projects/data-viz/hikes/stories/x/');
	assert.equal(ownFolder(place), '/images/projects/data-viz/hikes/places/y/');
});

test('an unknown lang is a 400', () => {
	for (const lang of ['fr', 'en', 'DE', '', 'de.md', '../de'])
		assert.throws(() => refFromQuery(q({ slug: 'x', date: '2026-01-01', lang })), is400, lang);
	assert.throws(() => refFromQuery(q({ place: 'y', lang: 'fr' })), is400);
	// A hike's sidecar alone has no translation file.
	assert.throws(() => refFromQuery(q({ slug: 'x', lang: 'de' })), is400);
});

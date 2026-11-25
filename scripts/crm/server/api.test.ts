import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, defaultRoutes, ApiError, type ApiRequest } from './api';

const req = (method: string, path: string): ApiRequest => ({
	method,
	path,
	query: new URLSearchParams(),
	headers: {}
});

test('ApiError from a handler keeps its status; other errors become 500', async () => {
	const api = createApi('/tmp/none', {
		'GET /api/boom': () => {
			throw new ApiError(409, 'x');
		},
		'GET /api/bad': () => {
			throw new Error('bad');
		}
	});
	assert.deepEqual(await api(req('GET', '/api/boom')), { status: 409, json: { error: 'x' } });
	assert.deepEqual(await api(req('GET', '/api/bad')), { status: 500, json: { error: 'bad' } });
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('GET and PATCH /api/doc: 200 with new version, 409 on stale base', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\n---\nB\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const got = await api({ ...req('GET', '/api/doc'), query: q });
	const doc = (got.json as any).doc;
	assert.equal(doc.fields['post.title'], 'T');
	assert.deepEqual((doc.mirrors as { url: string }[]).map((r) => r.url), ['', '', '']);
	const ops = [{ field: 'post.title', value: 'U' }];
	const ok = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.equal(ok.status, 200);
	assert.notEqual((ok.json as any).version, doc.version);
	const stale = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.equal(stale.status, 409);
	assert.equal((stale.json as any).error, 'changed on disk');
	assert.equal((stale.json as any).fields['post.title'], 'U');
	assert.match(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), /title: U/);
	const bad = await api({ ...req('PATCH', '/api/doc'), query: q, json: { nope: 1 } });
	assert.equal(bad.status, 400);
	for (const op of [null, 5, 'x', { kind: 'mirrors', rows: [{ title: 1, url: 'u' }] }, { kind: 'mirrors', rows: [null] }]) {
		const r = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops: [op] } });
		assert.equal(r.status, 400, JSON.stringify(op));
	}
});

test('PATCH /api/doc takes facts ops and answers with the facts', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\n---\nB\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const doc = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc;
	assert.deepEqual(doc.facts, { hike: null, post: null });
	const ops = [
		{ kind: 'facts', scope: 'hike', path: ['drones'], value: { en: 'No' } },
		{ kind: 'facts', scope: 'post', path: ['route', 'shade'], value: null }
	];
	const ok = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.equal(ok.status, 200);
	assert.deepEqual((ok.json as any).facts, { hike: { drones: { en: 'No' } }, post: { route: { shade: null } } });
	assert.equal(readFileSync(join(md, 'foo.hike.json'), 'utf8'), '{\n  "name": "Foo",\n  "facts": {\n    "drones": {\n      "en": "No"\n    }\n  }\n}\n');
	const stale = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.deepEqual((stale.json as any).facts, (ok.json as any).facts);
	for (const op of [{ kind: 'facts', scope: 'hike' }, { kind: 'facts', scope: 'x', path: [] }, { kind: 'facts', scope: 'post', path: [{}] }]) {
		const r = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: (ok.json as any).version, ops: [op] } });
		assert.equal(r.status, 400, JSON.stringify(op));
	}
});

test('PATCH /api/doc takes a lang op on a translated field and answers with the texts', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo' });
	const doc = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc;
	assert.deepEqual(doc.texts['sidecar.name'], { en: 'Foo' });
	const ok = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops: [{ field: 'sidecar.name', lang: 'de', value: 'Fu' }] } });
	assert.equal(ok.status, 200);
	assert.deepEqual((ok.json as any).texts['sidecar.name'], { en: 'Foo', de: 'Fu' });
	assert.equal((ok.json as any).fields['sidecar.name'], 'Foo');
	for (const op of [{ field: 'sidecar.name', lang: 'en', value: 'x' }, { field: 'sidecar.name', lang: 5, value: 'x' }, { field: 'sidecar.origin', lang: 'de', value: 'x' }]) {
		const r = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: (ok.json as any).version, ops: [op] } });
		assert.equal(r.status, 400, JSON.stringify(op));
	}
});

test(':param routes resolve and a literal route still wins', async () => {
	const seen: string[] = [];
	const api = createApi('/tmp/none', {
		'GET /api/x/:a/:b': (r) => (seen.push(`param ${r.params!.join(',')}`), { status: 200, json: {} }),
		'GET /api/x/lit/b': () => (seen.push('literal'), { status: 200, json: {} })
	});
	await api(req('GET', '/api/x/1/2'));
	await api(req('GET', '/api/x/lit/b'));
	assert.deepEqual(seen, ['param 1,2', 'literal']);
});

test('Immich client picks up settings edited after a missing-key 400, without a restart', async () => {
	const { makeTempRepo } = await import('./test-repo');
	const root = makeTempRepo();
	let cfg: { immichUrl?: string; immichKey?: string } = {};
	const api = createApi(root, defaultRoutes({ settings: () => cfg }));
	const first = await api(req('GET', '/api/immich/albums'));
	assert.equal(first.status, 400);
	assert.match((first.json as { error: string }).error, /immichKey/);
	cfg = { immichUrl: 'http://127.0.0.1:1', immichKey: 'k' };
	const second = await api(req('GET', '/api/immich/albums'));
	assert.equal(second.status, 502); // reached the (unreachable) server instead of the stale missing-key error
});

test('photo routes: add from the stub Immich, 409 on stale base, refuse removing a used photo, delete by encoded key', async () => {
	const { createStubImmich } = await import('./immich-client');
	const root = mkdtempSync(join(tmpdir(), 'crm-api-photos-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\n---\n![x](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)\n');
	const api = createApi(root, defaultRoutes({ immich: () => createStubImmich() }));
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const version = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc.version as string;

	const stale = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'immich', assetId: 'stub-asset-1', base: 'old' } });
	assert.equal(stale.status, 409);
	assert.equal((stale.json as any).version, version);

	const added = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'immich', assetId: 'stub-asset-1', base: version } });
	assert.equal(added.status, 200, JSON.stringify(added.json));
	assert.equal((added.json as any).key, '2024-01-01-01.jpg', 'number 00 is taken by the text');
	assert.equal((added.json as any).stamped, false);
	const post = readFileSync(join(md, '2024-01-01-foo.md'), 'utf8');
	assert.match(post, /2024-01-01-01\.jpg: \{w: 800, h: 600, lat: 47\.5964, lon: 12\.9412, taken: '2026-09-27T11:18:16\+02:00', blur: /);

	writeFileSync(join(md, '2024-01-01-foo.md'), post + '![y](/images/projects/data-viz/hikes/stories/foo/2024-01-01-01.jpg "autoplay")\n');
	const v2 = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc.version as string;
	const used = await api({ ...req('DELETE', '/api/photos/2024-01-01-01.jpg'), query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: v2 }) });
	assert.deepEqual([used.status, (used.json as any).error], [409, 'used in the text — remove it in Write first']);

	const up = await api({
		...req('PUT', '/api/photos/upload'),
		query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: v2, target: 'topo' }),
		headers: { 'x-filename': 'T%C3%B6po.jpg' },
		body: readFileSync(join(__dirname, 'fixtures/immich-stub/stub-asset-2.jpg'))
	});
	assert.equal(up.status, 200, JSON.stringify(up.json));
	assert.equal((up.json as any).key, '/images/hikes/topo/topo.jpg');

	const del = await api({ ...req('DELETE', '/api/photos/' + encodeURIComponent('/images/hikes/topo/topo.jpg')), query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: (up.json as any).version }) });
	assert.equal(del.status, 200, JSON.stringify(del.json));
	assert.equal((del.json as any).tiersRemoved, false, 'tiers outside the stories tree are never deleted');
	assert.doesNotMatch(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), /topo/);

	const badSource = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'flickr', base: version } });
	assert.equal(badSource.status, 400);
});

test('photo routes for a place doc: smart-search candidates, add to the place folder, list, badges, 409 with the place doc', async () => {
	const { createStubImmich } = await import('./immich-client');
	const root = mkdtempSync(join(tmpdir(), 'crm-api-place-photos-'));
	const dir = join(root, 'static/_projects/data-viz/hikes/places');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'foo.md'), '---\ntitle: Foo hut\ndescription: D\n---\nBody\n');
	const api = createApi(root, defaultRoutes({ immich: () => createStubImmich() }));
	const q = new URLSearchParams({ place: 'foo' });
	const cand = await api({ ...req('GET', '/api/photos/candidates'), query: new URLSearchParams({ place: 'foo', query: '', from: '2026-09-27', to: '2026-09-27' }) });
	assert.equal(cand.status, 200, JSON.stringify(cand.json));
	assert.deepEqual([(cand.json as any).query, (cand.json as any).album, (cand.json as any).bursts.length], ['Foo hut', null, 2]);
	const version = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc.version as string;
	const stale = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'immich', assetId: 'stub-asset-1', base: 'old' } });
	assert.deepEqual([stale.status, (stale.json as any).version, (stale.json as any).fields['place.title'], (stale.json as any).mirrors], [409, version, 'Foo hut', []]);
	const added = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'immich', assetId: 'stub-asset-1', base: version } });
	assert.equal(added.status, 200, JSON.stringify(added.json));
	assert.deepEqual([(added.json as any).key, (added.json as any).href, (added.json as any).stamped], ['2026-09-27-00.jpg', '/images/projects/data-viz/hikes/places/foo/2026-09-27-00.jpg', false]);
	const list = await api({ ...req('GET', '/api/photos/list'), query: q });
	assert.deepEqual((list.json as any).photos.map((p: any) => [p.key, p.assetId]), [['2026-09-27-00.jpg', 'stub-asset-1']]);
	const badges = await api({ ...req('GET', '/api/photos/badges'), query: q });
	assert.deepEqual((badges.json as any).badges, {});
	assert.equal((await api({ ...req('GET', '/api/photos/list'), query: new URLSearchParams({ place: '../x' }) })).status, 400);
});

test('POST /api/photos/link refuses an asset already linked to another photo of the post', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-link-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\nimages:\n  a.jpg: {w: 1, h: 2}\n  b.jpg: {w: 1, h: 2}\n---\nBody\n');
	const api = createApi(root, defaultRoutes());
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const id = '0f2b8c5e-1a2b-4c3d-8e9f-0123456789ab';
	const link = (key: string, assetId: string) => api({ ...req('POST', '/api/photos/link'), query: q, json: { key, assetId } });
	assert.equal((await link('a.jpg', id)).status, 200);
	assert.equal((await link('a.jpg', id)).status, 200, 'relinking the same photo is fine');
	const dup = await link('b.jpg', id);
	assert.equal(dup.status, 409);
	assert.match((dup.json as any).error, /a\.jpg/);
	assert.deepEqual(JSON.parse(readFileSync(join(root, 'scripts/crm/data/immich-links.json'), 'utf8')), { '2024-01-01-foo.md': { 'a.jpg': id } });
});

test('pin routes: state, save pins (400 for a ref not in the store), caption, caption places', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-pins-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\nimages:\n  a.jpg: {w: 4, h: 3}\n---\n![Old](/images/projects/data-viz/hikes/stories/foo/a.jpg)\n');
	writeFileSync(join(root, 'static/_projects/data-viz/hikes/osm.json'), JSON.stringify({ 'node/1': { lat: 47, lon: 11, tags: { name: 'Wallberg' } } }));
	const api = createApi(root, defaultRoutes());
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const version = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc.version as string;
	const state = await api({ ...req('GET', '/api/photos/pins'), query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', key: 'a.jpg' }) });
	assert.equal(state.status, 200, JSON.stringify(state.json));
	assert.deepEqual([(state.json as any).caption, (state.json as any).captionState, (state.json as any).pins], ['Old', 'ok', []]);

	const bad = await api({ ...req('POST', '/api/photos/pins'), query: q, json: { key: 'a.jpg', pins: [{ ref: 'node/9', x: 0.5, y: 0.5 }], base: version } });
	assert.equal(bad.status, 400);
	const stale = await api({ ...req('POST', '/api/photos/pins'), query: q, json: { key: 'a.jpg', pins: [], base: 'old' } });
	assert.deepEqual([stale.status, (stale.json as any).version], [409, version]);
	const saved = await api({ ...req('POST', '/api/photos/pins'), query: q, json: { key: 'a.jpg', pins: [{ ref: 'node/1', x: 0.25, y: 0.5 }], base: version } });
	assert.equal(saved.status, 200, JSON.stringify(saved.json));

	const cap = await api({ ...req('POST', '/api/photos/caption'), query: q, json: { key: 'a.jpg', text: 'Wallberg', base: (saved.json as any).version } });
	assert.equal(cap.status, 200, JSON.stringify(cap.json));
	assert.match(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), /^!\[Wallberg\]\(/m);
	const notPlaced = await api({ ...req('POST', '/api/photos/caption'), query: q, json: { key: 'zz.jpg', text: 'x', base: (cap.json as any).version } });
	assert.equal(notPlaced.status, 409);
	assert.equal((notPlaced.json as any).version, undefined, 'a refusal, not a stale base');

	const places = await api({ ...req('GET', '/api/photos/caption-places'), query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', text: 'Up to Wallberg' }) });
	assert.deepEqual(places, { status: 200, json: { places: [{ ref: 'node/1', name: 'Wallberg', lat: 47, lon: 11 }] } });
});

test('place docs: POST /api/places, GET and PATCH /api/doc?place=, body ops', async () => {
	const { makeTempRepo } = await import('./test-repo');
	const root = makeTempRepo();
	const api = createApi(root);
	const made = await api({ ...req('POST', '/api/places'), json: { slug: 'new_place', title: 'New Place', description: 'D' } });
	assert.deepEqual(made, { status: 200, json: { slug: 'new_place' } });
	assert.equal((await api({ ...req('POST', '/api/places'), json: { slug: 'new_place', title: 'x', description: 'y' } })).status, 409);
	assert.equal((await api({ ...req('POST', '/api/places'), json: { slug: 'new_place' } })).status, 400);
	assert.equal((await api({ ...req('POST', '/api/places'), json: { slug: 'other_place', title: 'T' } })).status, 400);
	assert.equal((await api({ ...req('POST', '/api/places'), json: { slug: 'other_place', title: 'T', description: ' ' } })).status, 400);
	const list = await api(req('GET', '/api/hikes'));
	assert.ok((list.json as { places: { slug: string }[] }).places.some((p) => p.slug === 'new_place'));
	const q = new URLSearchParams({ place: 'new_place' });
	const doc = ((await api({ ...req('GET', '/api/doc'), query: q })).json as any).doc;
	assert.deepEqual({ ...doc, version: '' }, { kind: 'place', slug: 'new_place', version: '', fields: { 'place.title': 'New Place', 'place.description': 'D' }, body: '' });
	const ops = [{ field: 'place.description', value: 'E' }, { kind: 'body', text: 'Hello\n' }];
	const ok = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.equal(ok.status, 200);
	assert.equal((ok.json as any).body, 'Hello\n');
	assert.equal(readFileSync(join(root, 'static/_projects/data-viz/hikes/places/new_place.md'), 'utf8'), '---\ntitle: New Place\ndescription: E\n---\nHello\n');
	const stale = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: doc.version, ops } });
	assert.equal(stale.status, 409);
	assert.equal((stale.json as any).body, 'Hello\n');
	for (const op of [{ kind: 'body' }, { kind: 'body', text: 5 }])
		assert.equal((await api({ ...req('PATCH', '/api/doc'), query: q, json: { base: (ok.json as any).version, ops: [op] } })).status, 400, JSON.stringify(op));
	// Post and hike docs carry kind and body; a body op on a hike (no post) is a 400.
	const post = ((await api({ ...req('GET', '/api/doc'), query: new URLSearchParams({ slug: 'wendelstein', date: '2025-06-10' }) })).json as any).doc;
	assert.equal(post?.kind, 'post');
	assert.equal(typeof post.body, 'string');
	const hq = new URLSearchParams({ slug: 'wendelstein' });
	const hike = ((await api({ ...req('GET', '/api/doc'), query: hq })).json as any).doc;
	assert.equal(hike.kind, 'hike');
	assert.equal(hike.body, null);
	assert.equal((await api({ ...req('PATCH', '/api/doc'), query: hq, json: { base: hike.version, ops: [{ kind: 'body', text: 'x' }] } })).status, 400);
	assert.equal((await api({ ...req('GET', '/api/map'), query: q })).status, 400);
});

test('409s of file uploads and metrics recompute carry the body; unreadable front matter is 422', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\n---\nB\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: 'stale' });
	const up = await api({ ...req('PUT', '/api/files/geojson'), query: q, body: Buffer.from('{}') });
	assert.equal(up.status, 409);
	assert.equal((up.json as any).body, 'B\n');
	const re = await api({ ...req('POST', '/api/metrics/recompute'), query: q });
	assert.equal(re.status, 409);
	assert.equal((re.json as any).body, 'B\n');
	const dq = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	for (const raw of ['---\r\ntitle: T\r\n---\r\nB\r\n', '---\ntitle: T\nno closing fence\n']) {
		writeFileSync(join(md, '2024-01-01-foo.md'), raw);
		const got = await api({ ...req('GET', '/api/doc'), query: dq });
		assert.equal(got.status, 422, JSON.stringify(raw));
		assert.match((got.json as any).error, /^front matter not readable/);
		const version = (await import('./doc')).loadDoc(root, 'foo', '2024-01-01').version;
		const patch = await api({ ...req('PATCH', '/api/doc'), query: dq, json: { base: version, ops: [{ kind: 'body', text: 'x' }] } });
		assert.equal(patch.status, 422);
		assert.equal(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), raw);
	}
});

test('photo, video and YouTube 409s carry the body', async () => {
	const { createStubImmich } = await import('./immich-client');
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: T\n---\nA\nIDE paragraph\n');
	mkdirSync(join(root, 'static/_projects/data-viz/hikes/places'), { recursive: true });
	writeFileSync(join(root, 'static/_projects/data-viz/hikes/places/foo.md'), '---\ntitle: Foo hut\ndescription: D\n---\nPlace text\n');
	const api = createApi(root, defaultRoutes({ immich: () => createStubImmich() }));
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	const photo = await api({ ...req('POST', '/api/photos/add'), query: q, json: { source: 'immich', assetId: 'stub-asset-1', base: 'old' } });
	const place = await api({ ...req('POST', '/api/photos/add'), query: new URLSearchParams({ place: 'foo' }), json: { source: 'immich', assetId: 'stub-asset-1', base: 'old' } });
	async function* one(): AsyncIterable<Buffer> {
		yield Buffer.from('x');
	}
	const video = await api({ ...req('PUT', '/api/write/video'), query: new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: 'old' }), stream: one() });
	const youtube = await api({ ...req('POST', '/api/write/youtube'), query: q, json: { url: 'https://www.youtube.com/watch?v=B5yRsnelCsw', base: 'old' } });
	assert.deepEqual(
		[photo, place, video, youtube].map((r) => [r.status, (r.json as any).body]),
		[[409, 'A\nIDE paragraph\n'], [409, 'Place text\n'], [409, 'A\nIDE paragraph\n'], [409, 'A\nIDE paragraph\n']]
	);
});

test('front matter YAML that does not parse is 422 for the doc and the preview, not 500', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: [unclosed\n---\nB\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01' });
	for (const path of ['/api/doc', '/api/preview']) {
		const r = await api({ ...req('GET', path), query: q });
		assert.equal(r.status, 422, path);
		assert.match((r.json as any).error, /^front matter not readable: /, path);
	}
});

test('places payload reflects an osm.json changed after server start', async () => {
	const { makeTempRepo } = await import('./test-repo');
	const { repoPaths } = await import('./paths');
	const root = makeTempRepo();
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'zugspitze_reintal', date: '2025-06-21' });
	const first = await api({ ...req('GET', '/api/write/places'), query: q });
	assert.equal(first.status, 200);
	const p = first.json as { nodes: { ref: string; lat: number; tags: Record<string, unknown> }[]; origin: unknown; height: unknown; ownRefs: string[]; placeDocs: { slug: string; names: string[] }[] };
	// As the post page loader builds it: the sidecar's origin, height and nodes, the post's `places:`.
	const sidecar = JSON.parse(readFileSync(join(repoPaths(root).markdown, 'zugspitze_reintal.hike.json'), 'utf8'));
	assert.deepEqual(p.origin, sidecar.origin);
	assert.equal(p.height, sidecar.height);
	assert.deepEqual(p.ownRefs, sidecar.nodes.filter((r: string) => p.nodes.some((n) => n.ref === r)));
	assert.deepEqual(p.placeDocs.map((d) => d.slug), ['knorrhuette']);
	assert.ok(p.placeDocs[0].names.includes('Knorrhütte'));
	assert.ok(!p.nodes.some((n) => n.ref === 'node/999999001'));

	// The store changes on disk (another tab, the IDE): the next request sees it, local tags over OSM's.
	const file = repoPaths(root).osmStore;
	const store = JSON.parse(readFileSync(file, 'utf8'));
	store['node/999999001'] = { lat: 47.41, lon: 11.0, tags: { name: 'Neuer Gipfel', ele: '1999' }, local: { name: 'Neuester Gipfel' } };
	writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
	const second = (await api({ ...req('GET', '/api/write/places'), query: q })).json as typeof p;
	const added = second.nodes.find((n) => n.ref === 'node/999999001');
	assert.equal(added?.tags.name, 'Neuester Gipfel');

	// A place doc: no origin or height, no own nodes, no place docs of its own.
	const place = await api({ ...req('GET', '/api/write/places'), query: new URLSearchParams({ place: 'knorrhuette' }) });
	assert.equal(place.status, 200);
	assert.deepEqual({ ...(place.json as typeof p), nodes: [] }, { nodes: [], origin: null, height: null, ownRefs: [], placeDocs: [] });
	assert.ok((place.json as typeof p).nodes.some((n) => n.ref === 'node/999999001'));
});

test('unreadable front matter: the places payload keeps the nodes, without place docs; the preview says why', async () => {
	const { makeTempRepo } = await import('./test-repo');
	const { repoPaths } = await import('./paths');
	const root = makeTempRepo();
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'zugspitze_reintal', date: '2025-06-21' });
	const good = (await api({ ...req('GET', '/api/write/places'), query: q })).json as { nodes: unknown[]; origin: unknown; height: unknown; ownRefs: string[]; placeDocs: unknown[] };
	assert.ok(good.placeDocs.length > 0 && good.nodes.length > 0);
	const post = join(repoPaths(root).markdown, '2025-06-21-zugspitze_reintal.md');
	const raw = readFileSync(post, 'utf8');
	// CRLF (no LF-terminated closing fence) and broken YAML.
	for (const bad of [raw.replace(/\n/g, '\r\n'), raw.replace(/^---\n/, '---\ntitle: [unclosed\n')]) {
		writeFileSync(post, bad);
		const got = await api({ ...req('GET', '/api/write/places'), query: q });
		assert.equal(got.status, 200, JSON.stringify(got.json));
		// The sidecar's nodes, origin and height still serve suggestions and underlines; which docs the post names is unknown.
		assert.deepEqual(got.json, { ...good, placeDocs: [] });
	}
	writeFileSync(post, raw.replace(/\n/g, '\r\n'));
	const preview = await api({ ...req('GET', '/api/preview'), query: q });
	assert.equal(preview.status, 422);
	assert.match((preview.json as any).error, /^front matter not readable/);
});

test('a facts op needs a non-empty path of names and indices, and remove without a value', async () => {
	const root = mkdtempSync(join(tmpdir(), 'crm-api-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	const api = createApi(root);
	const q = new URLSearchParams({ slug: 'foo' });
	const got = await api({ ...req('GET', '/api/doc'), query: q });
	const base = (got.json as any).doc.version;
	const bad = [
		{ kind: 'facts', scope: 'hike', path: [''], value: 1 },
		{ kind: 'facts', scope: 'hike', path: ['a', -1], value: 1 },
		{ kind: 'facts', scope: 'hike', path: ['a', 1.5], value: 1 },
		{ kind: 'facts', scope: 'hike', path: ['a'], remove: true, value: 1 }
	];
	for (const op of bad) {
		const r = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base, ops: [op] } });
		assert.equal(r.status, 400, JSON.stringify(op));
	}
	const ok = await api({ ...req('PATCH', '/api/doc'), query: q, json: { base, ops: [{ kind: 'facts', scope: 'hike', path: ['drones'], value: 'No' }] } });
	assert.equal(ok.status, 200);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tilePosition } from './terrain';
import { makeTempRepo } from './test-repo';
import { repoPaths } from './paths';
import { addToStore, osmAround, osmSearch, parseRef, refreshElement, setLocal, storeVersion } from './osm-service';
import { createStubClient, type OsmClient, type RawElement } from './osm-client';
import { createApi, defaultRoutes } from './api';
import { ApiError } from './errors';

const stub = createStubClient();
const deps = { client: stub, today: () => '2026-10-29' };

test('parseRef accepts n/w/r, typed ids and openstreetmap.org links', () => {
	assert.equal(parseRef('node/1'), 'node/1');
	assert.equal(parseRef(' n12 '), 'node/12');
	assert.equal(parseRef('W2'), 'way/2');
	assert.equal(parseRef('r003'), 'relation/3');
	assert.equal(parseRef('https://www.openstreetmap.org/way/2#map=17/1/2'), 'way/2');
	assert.equal(parseRef('https://openstreetmap.org/relation/9?x=1'), 'relation/9');
	for (const bad of ['', 'foo', 'node/', 'https://example.com/node/1']) assert.throws(() => parseRef(bad), (e: unknown) => e instanceof ApiError && e.status === 400);
});

test('addToStore keeps local and writes byte-compatible JSON', async () => {
	const root = makeTempRepo();
	const file = repoPaths(root).osmStore;
	const before = readFileSync(file, 'utf-8');
	const r = await addToStore(root, ['node/900001'], storeVersion(root), deps);
	assert.equal(r.version, storeVersion(root));
	assert.equal(r.entries['node/900001'].fetched, '2026-10-29');
	assert.deepEqual(Object.keys(r.entries['node/900001']), ['lat', 'lon', 'tags', 'fetched']);
	const a = before.split('\n'), b = readFileSync(file, 'utf-8').split('\n');
	let i = 0;
	while (a[i] === b[i]) i++;
	const extra = b.length - a.length;
	assert.ok(extra > 0);
	assert.deepEqual(b.slice(i + extra), a.slice(i), 'only the new block was inserted');

	await setLocal(root, 'node/900001', { visited: 'yes' }, storeVersion(root));
	const again = await addToStore(root, ['node/900001', 'way/900002'], storeVersion(root), { ...deps, today: () => '2026-11-01' });
	assert.deepEqual(again.entries['node/900001'].local, { visited: 'yes' });
	assert.equal(again.entries['node/900001'].fetched, '2026-11-01');
	assert.equal(again.entries['way/900002'].lat, 47.601);
	await assert.rejects(addToStore(root, ['node/1'], storeVersion(root), deps), (e: unknown) => e instanceof ApiError && e.status === 404);
});

function clientWith(el: RawElement): OsmClient {
	return { ...stub, elements: async () => ({ [`${el.type}/${el.id}`]: el }) };
}

test('refresh replaces tags, keeps local, reports diff and redundant local keys', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['node/900001'], storeVersion(root), deps);
	await setLocal(root, 'node/900001', { ele: '1800', name: null, visited: 'no', note: 'mine' }, storeVersion(root));
	const fresh: RawElement = { type: 'node', id: 900001, lat: 47.6, lon: 11.5, tags: { name: 'Stubspitze', natural: 'peak', ele: '1801', fixme: 'x' } };
	const r = await refreshElement(root, 'node/900001', storeVersion(root), { client: clientWith(fresh), today: () => '2026-12-01' });
	assert.deepEqual(r.entry.tags, fresh.tags);
	assert.deepEqual(r.entry.local, { ele: '1800', name: null, visited: 'no', note: 'mine' });
	assert.deepEqual(r.diff, { added: { fixme: 'x' }, removed: {}, changed: { ele: { from: '1800', to: '1801' } } });
	assert.deepEqual(r.redundantLocal, []);
	const same: RawElement = { ...fresh, tags: { natural: 'peak', ele: '1800' } };
	const r2 = await refreshElement(root, 'node/900001', storeVersion(root), { client: clientWith(same), today: () => '2026-12-02' });
	assert.deepEqual(r2.redundantLocal.sort(), ['ele', 'name']);
	assert.deepEqual(r2.diff.removed, { name: 'Stubspitze', fixme: 'x' });
});

test('setLocal: null values, empty removes local, visited validated', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['node/900001'], storeVersion(root), deps);
	const r = await setLocal(root, 'node/900001', { ele: null }, storeVersion(root));
	assert.deepEqual(r.entry.local, { ele: null });
	await assert.rejects(setLocal(root, 'node/900001', { visited: 'maybe' }, storeVersion(root)), (e: unknown) => e instanceof ApiError && e.status === 400);
	const r2 = await setLocal(root, 'node/900001', {}, storeVersion(root));
	assert.ok(!('local' in r2.entry));
	assert.ok(!('local' in JSON.parse(readFileSync(repoPaths(root).osmStore, 'utf-8'))['node/900001']));
	await assert.rejects(setLocal(root, 'node/5', { a: 'b' }, storeVersion(root)), (e: unknown) => e instanceof ApiError && e.status === 404);
});

test('stale store version -> 409, file untouched', async () => {
	const root = makeTempRepo();
	const file = repoPaths(root).osmStore;
	const base = storeVersion(root);
	writeFileSync(file, readFileSync(file, 'utf-8') + '\n');
	const before = readFileSync(file);
	const stale = (e: unknown) => e instanceof ApiError && e.status === 409 && (e as any).version === storeVersion(root);
	await assert.rejects(addToStore(root, ['node/900001'], base, deps), stale);
	await assert.rejects(setLocal(root, 'node/1', { a: 'b' }, base), stale);
	await assert.rejects(refreshElement(root, 'node/900001', base, deps), stale);
	assert.deepEqual(readFileSync(file), before);
});

test('around: nodes, ways, relations then distance, inStore flag; r clamped', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['way/900002'], storeVersion(root), deps);
	let radius = 0;
	const client: OsmClient = { ...stub, around: async (la, lo, r) => ((radius = r), stub.around(la, lo, r)) };
	const items = await osmAround(root, 47.6, 11.5, 1000, client);
	assert.equal(radius, 200);
	assert.deepEqual(items.map((i) => [i.ref, i.kind, i.inStore]), [
		['node/900001', 'natural=peak', false],
		['way/900002', 'tourism=alpine_hut', true],
		['relation/900003', 'route=hiking', false]
	]);
	await osmAround(root, 47.6, 11.5, 1, client);
	assert.equal(radius, 5);
});

test('around: the areas the point is inside come after every nearby feature', async () => {
	const root = makeTempRepo();
	const at = (type: RawElement['type'], id: number, lat: number, extra: Partial<RawElement> = {}): RawElement =>
		({ type, id, tags: { name: `${type}${id}` }, ...(type === 'node' ? { lat, lon: 11.5 } : { center: { lat, lon: 11.5 } }), ...extra }) as RawElement;
	const client: OsmClient = {
		...stub,
		around: async () => [at('relation', 1, 47.6, { enclosing: true }), at('way', 2, 47.6, { enclosing: true }), at('relation', 3, 47.601), at('node', 4, 47.6005)]
	};
	assert.deepEqual((await osmAround(root, 47.6, 11.5, 30, client)).map((i) => i.ref), ['node/4', 'relation/3', 'way/2', 'relation/1']);
});

test('search: store names folded first, then Overpass; pasted ids resolve directly', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['way/900002'], storeVersion(root), deps);
	const r = await osmSearch(root, 'STUB hutte', 47.6, 11.5, stub);
	assert.deepEqual(r.store.map((i) => i.ref), ['way/900002']);
	assert.deepEqual(r.osm, []);
	const r2 = await osmSearch(root, 'stub', 47.6, 11.5, stub);
	assert.deepEqual(r2.osm.map((i) => i.ref).sort(), ['node/900001', 'relation/900003']);
	assert.ok(r2.store.length === 1);
	const r3 = await osmSearch(root, 'https://www.openstreetmap.org/node/900001', null, null, stub);
	assert.equal(r3.osm[0].ref, 'node/900001');
	const failing: OsmClient = { ...stub, searchName: async () => { throw new ApiError(503, 'OSM is busy'); } };
	assert.equal((await osmSearch(root, 'stub', 1, 1, failing) as any).osm_error, 'OSM is busy');
});

test('search source: store never calls OSM, osm skips the store', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['way/900002'], storeVersion(root), deps);
	const offline: OsmClient = { ...stub, searchName: async () => assert.fail('store search called Overpass'), elements: async () => assert.fail('store search called the OSM API') };
	const s = await osmSearch(root, 'tub h', 47.6, 11.5, offline, null, 'store');
	assert.deepEqual(s.store.map((i) => i.ref), ['way/900002'], 'substring match');
	assert.deepEqual(s.osm, []);
	assert.deepEqual(await osmSearch(root, 'node/900001', null, null, offline, null, 'store'), { store: [], osm: [] }, 'a pasted id not in the store');
	assert.equal((await osmSearch(root, 'way/900002', null, null, offline, null, 'store')).store[0].ref, 'way/900002');
	const o = await osmSearch(root, 'stub', 47.6, 11.5, stub, null, 'osm');
	assert.deepEqual(o.store, []);
	assert.deepEqual(o.osm.map((i) => [i.ref, i.inStore]).sort(), [['node/900001', false], ['relation/900003', false], ['way/900002', true]], 'store elements OSM finds are flagged, not dropped');
});

test('routes: add / local / refresh with stale base answer 409 { error, version }', async () => {
	const root = makeTempRepo();
	const api = createApi(root, defaultRoutes({ osm: stub }));
	const call = (method: string, path: string, json?: unknown, q = '') => api({ method, path, query: new URLSearchParams(q), json, headers: {} });
	const v = (await call('GET', '/api/osm/store/version')).json as { version: string };
	const add = await call('POST', '/api/osm/add', { refs: ['n900001'], base: v.version });
	assert.equal(add.status, 200);
	const stale = await call('POST', '/api/osm/add', { refs: ['n900001'], base: v.version });
	assert.equal(stale.status, 409);
	assert.equal((stale.json as any).version, storeVersion(root));
	const loc = await call('PATCH', '/api/osm/local', { ref: 'node/900001', local: { visited: 'yes' }, base: storeVersion(root) });
	assert.equal(loc.status, 200);
	assert.equal((await call('POST', '/api/osm/refresh', { ref: 'node/900001', base: storeVersion(root) })).status, 200);
	assert.equal((await call('GET', '/api/osm/around', undefined, 'lat=47.6&lon=11.5&r=30')).status, 200);
	assert.equal((await call('GET', '/api/osm/around', undefined, 'lon=11.5')).status, 400);
	assert.equal((await call('GET', '/api/osm/search', undefined, 'q=stub')).status, 200);
	assert.equal((await call('GET', '/api/osm/search', undefined, 'q=stub&source=nope')).status, 400);
	assert.equal((await call('POST', '/api/osm/add', { refs: 'x' })).status, 400);
});

test('whole-number coordinates are written as 47.0 / 11.0 and round-trip', async () => {
	const root = makeTempRepo();
	const el: RawElement = { type: 'way', id: 900010, center: { lat: 47, lon: 11 }, tags: { name: 'W' } };
	await addToStore(root, ['way/900010'], storeVersion(root), { client: clientWith(el), today: () => '2026-10-29' });
	const file = repoPaths(root).osmStore;
	const text = readFileSync(file, 'utf-8');
	assert.match(text, /"lat": 47\.0,\n\s+"lon": 11\.0,/);
	const { readStore, writeStore } = await import('../lib/osm-store-file');
	writeStore(file, readStore(file));
	assert.equal(readFileSync(file, 'utf-8'), text);
});

test('setLocal completes while an addToStore fetch is still pending', async () => {
	const root = makeTempRepo();
	await addToStore(root, ['node/900001'], storeVersion(root), deps);
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const slow: OsmClient = { ...stub, elements: async (refs) => (await gate, stub.elements(refs)) };
	const base = storeVersion(root);
	const adding = addToStore(root, ['way/900002'], base, { client: slow, today: () => '2026-10-29' });
	await setLocal(root, 'node/900001', { visited: 'yes' }, base);
	release();
	// the local save changed the store, so the pending add is now stale
	await assert.rejects(adding, (e: unknown) => e instanceof ApiError && e.status === 409);
});

test('around with a non-numeric r -> 400', async () => {
	const api = createApi(makeTempRepo(), defaultRoutes({ osm: stub }));
	const r = await api({ method: 'GET', path: '/api/osm/around', query: new URLSearchParams('lat=1&lon=2&r=abc'), headers: {} });
	assert.equal(r.status, 400);
});

test('a malformed DEM tile stores the element without demEle instead of failing', async () => {
	const root = makeTempRepo();
	const el: RawElement = { type: 'node', id: 900005, lat: 47.6, lon: 11.5, tags: { natural: 'peak' } };
	const [x, y] = tilePosition(el.lat!, el.lon!);
	mkdirSync(repoPaths(root).demDir, { recursive: true });
	writeFileSync(path.join(repoPaths(root).demDir, `13_${Math.floor(x)}_${Math.floor(y)}.png`), 'not a png');
	const r = await addToStore(root, ['node/900005'], storeVersion(root), { client: clientWith(el), today: () => '2026-10-29' });
	assert.equal(r.entries['node/900005'].lat, 47.6);
	assert.equal('demEle' in r.entries['node/900005'], false);
});

test('search with slug sorts by distance from the route', async () => {
	const root = makeTempRepo();
	// A straight route east along 47.6, from 11.50 to 11.54: its midpoint is 11.52.
	mkdirSync(repoPaths(root).geojson, { recursive: true });
	const line = { type: 'LineString', coordinates: [[11.5, 47.6], [11.53, 47.6], [11.54, 47.6]] };
	writeFileSync(path.join(repoPaths(root).geojson, 'stub_route.json'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: line }] }));
	const els: RawElement[] = [
		// Beside the midpoint, 220 m off the line.
		{ type: 'node', id: 910001, lat: 47.602, lon: 11.52, tags: { name: 'Stubroute Alm' } },
		// Near the end, 55 m off the line.
		{ type: 'node', id: 910002, lat: 47.6005, lon: 11.5395, tags: { name: 'Stubroute Quelle' } },
		{ type: 'node', id: 910003, lat: 47.61, lon: 11.51, tags: { name: 'Stubroute Kreuz' } },
		{ type: 'node', id: 910004, lat: 47.6001, lon: 11.505, tags: { name: 'Stubroute Bank' } }
	];
	let centre: number[] = [];
	const client: OsmClient = {
		...stub,
		elements: async (refs) => Object.fromEntries(els.filter((e) => refs.includes(`node/${e.id}`)).map((e) => [`node/${e.id}`, e])),
		searchName: async (_name, lat, lon) => ((centre = [lat, lon]), els.slice(2))
	};
	await addToStore(root, ['node/910001', 'node/910002'], storeVersion(root), { client, today: () => '2026-10-29' });
	const api = createApi(root, defaultRoutes({ osm: client }));
	const search = async (q: string) => (await api({ method: 'GET', path: '/api/osm/search', query: new URLSearchParams(q), json: undefined, headers: {} })).json as any;

	const plain = await search('q=stubroute&lat=1&lon=2');
	assert.deepEqual(plain.store.map((i: any) => i.ref), ['node/910001', 'node/910002'], 'without a slug: store order');
	assert.deepEqual(plain.osm.map((i: any) => i.ref), ['node/910003', 'node/910004']);
	assert.deepEqual(centre, [1, 2]);

	const near = await search('q=stubroute&slug=stub_route');
	assert.deepEqual(near.store.map((i: any) => i.ref), ['node/910002', 'node/910001'], 'the one near the end is nearer the line');
	assert.deepEqual(near.osm.map((i: any) => i.ref), ['node/910004', 'node/910003']);
	assert.deepEqual(centre, [47.6, 11.52], 'OSM is searched around the route midpoint');
	// A hike without a route file searches as before.
	assert.deepEqual((await search('q=stubroute&slug=no_such_route')).store.map((i: any) => i.ref), ['node/910001', 'node/910002']);
});

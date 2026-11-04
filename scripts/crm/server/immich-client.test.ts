import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApiError } from './errors';
import { createImmich, createStubImmich } from './immich-client';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'crm-immich-'));
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
const raw = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	type: 'IMAGE',
	originalFileName: `${id}.jpg`,
	localDateTime: '2026-09-27T11:18:16.000Z',
	fileCreatedAt: '2026-09-27T09:18:16.000Z',
	exifInfo: { dateTimeOriginal: '2026-09-27T09:18:16.000Z', timeZone: 'Europe/Berlin', exifImageWidth: 4000, exifImageHeight: 3000, orientation: '1' },
	...over
});
const make = (fetchStub: (url: string, init: any) => Promise<Response>, extra: Record<string, unknown> = {}) =>
	createImmich({ url: 'http://immich.test/', key: 'secret', cacheDir: tmp(), fetch: fetchStub as unknown as typeof fetch, ...extra });

test('search pages through nextPage and keeps images only', async () => {
	const bodies: any[] = [];
	const im = make(async (url, init) => {
		assert.equal(url, 'http://immich.test/api/search/metadata');
		assert.equal(init.headers['x-api-key'], 'secret');
		const b = JSON.parse(init.body);
		bodies.push(b);
		return b.page === 1
			? json({ assets: { items: [raw('a'), raw('v', { type: 'VIDEO' })], nextPage: '2' } })
			: json({ assets: { items: [raw('b')], nextPage: null } });
	});
	const out = await im.search({ albumId: 'alb', takenAfter: '2026-09-27T00:00:00Z' });
	assert.deepEqual(out.map((a) => a.id), ['a', 'b']);
	assert.deepEqual(bodies.map((b) => b.page), [1, 2]);
	assert.deepEqual(bodies[0].albumIds, ['alb']);
	assert.equal(bodies[0].takenAfter, '2026-09-27T00:00:00Z');
	assert.equal(bodies[0].type, 'IMAGE');
	assert.equal(bodies[0].withExif, true);
});

test("takenLocal carries the asset's offset", async () => {
	const im = make(async () => json(raw('a', { exifInfo: { ...raw('a').exifInfo, latitude: 47.5, longitude: 12.9, fileSizeInByte: 10 } })));
	const a = await im.asset('a');
	assert.equal(a.takenLocal, '2026-09-27T11:18:16+02:00');
	assert.deepEqual([a.lat, a.lon, a.fileSize, a.fileName], [47.5, 12.9, 10, 'a.jpg']);
	const w = make(async () => json(raw('a', { exifInfo: { dateTimeOriginal: '2026-01-15T09:00:00.000Z', timeZone: 'UTC-3:30' } })));
	assert.equal((await w.asset('a')).takenLocal, '2026-01-15T05:30:00-03:30');
});

test('takenLocal falls back to localDateTime when there is no exif time', async () => {
	const im = make(async () => json(raw('a', { exifInfo: {} })));
	assert.equal((await im.asset('a')).takenLocal, '2026-09-27T11:18:16+02:00');
});

test('orientation 6 swaps width/height', async () => {
	const im = make(async () => json(raw('a', { exifInfo: { ...raw('a').exifInfo, orientation: '6' } })));
	const a = await im.asset('a');
	assert.deepEqual([a.width, a.height], [3000, 4000]);
});

// Real Immich v3 (checked read-only): a Samsung HEIC with orientation 6 reports exifImageWidth/Height 8160x6120 (as stored,
// pre-rotation) and asset width/height 6120x8160 (upright). Asset width/height are upright and must not be swapped again.
test('upright asset width/height win and are not swapped for orientation 5-8', async () => {
	const ex = { ...raw('a').exifInfo, exifImageWidth: 8160, exifImageHeight: 6120, orientation: '6' };
	const both = await make(async () => json(raw('a', { width: 6120, height: 8160, exifInfo: ex }))).asset('a');
	assert.deepEqual([both.width, both.height], [6120, 8160]);
	const { exifImageWidth: _w, exifImageHeight: _h, ...noDims } = ex;
	const assetOnly = await make(async () => json(raw('a', { width: 6120, height: 8160, exifInfo: { ...noDims, orientation: '8' } }))).asset('a');
	assert.deepEqual([assetOnly.width, assetOnly.height], [6120, 8160]);
});

test('thumbs are cached and evicted past the cap', async () => {
	const urls: string[] = [];
	const dir = tmp();
	const im = createImmich({
		url: 'http://immich.test',
		key: 'k',
		cacheDir: dir,
		capBytes: 250,
		fetch: (async (url: string) => {
			urls.push(url);
			return new Response(Buffer.alloc(100, 1), { status: 200, headers: { 'content-type': 'image/jpeg' } });
		}) as unknown as typeof fetch
	});
	const [x, y] = await Promise.all([im.thumb('a', 'thumbnail'), im.thumb('a', 'thumbnail')]);
	assert.equal(x.length, 100);
	assert.equal(y.length, 100);
	await im.thumb('a', 'thumbnail');
	assert.deepEqual(urls, ['http://immich.test/api/assets/a/thumbnail?size=thumbnail']);
	await im.thumb('a', 'preview');
	await im.thumb('a', 'thumbnail'); // hit: a-thumbnail becomes more recent than a-preview
	await im.thumb('b', 'thumbnail'); // 300 > 250: the least recently used (a-preview) goes
	const left = readdirSync(dir).filter((f) => !f.endsWith('.tmp')).sort();
	assert.deepEqual(left, ['a-thumbnail.img', 'b-thumbnail.img']);
	await assert.rejects(() => im.thumb('../x', 'thumbnail'), (e: any) => e instanceof ApiError && e.status === 400);
});

test('missing key → ApiError 400 naming the setting', async () => {
	const im = createImmich({ url: 'http://immich.test', key: undefined, cacheDir: tmp(), fetch: (async () => json({})) as unknown as typeof fetch });
	await assert.rejects(
		() => im.albums(),
		(e: any) => e instanceof ApiError && e.status === 400 && /immichUrl and immichKey/.test(e.message) && /IMMICH_API_KEY/.test(e.message)
	);
});

test('network error → 502, upstream error status → 502', async () => {
	const down = make(async () => {
		throw new TypeError('fetch failed');
	});
	await assert.rejects(() => down.albums(), (e: any) => e instanceof ApiError && e.status === 502 && /Immich unreachable/.test(e.message));
	const bad = make(async () => new Response('no', { status: 500 }));
	await assert.rejects(() => bad.asset('a'), (e: any) => e instanceof ApiError && e.status === 502 && !/secret/.test(e.message));
});

test('every call carries a timeout signal; a timeout is reported as unreachable (timeout)', async () => {
	const seen: { url: string; signal: unknown }[] = [];
	const hang = (url: string, init: any) => {
		seen.push({ url, signal: init.signal });
		return new Promise<Response>((_, reject) => {
			init.signal?.addEventListener('abort', () => reject(init.signal.reason));
		});
	};
	const im = make(hang, { timeoutMs: 20, downloadTimeoutMs: 60 });
	const t0 = Date.now();
	const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout's timer is unref'd; hold the loop open
	await assert.rejects(() => im.albums(), (e: any) => e instanceof ApiError && e.status === 502 && e.message === 'Immich unreachable (timeout)');
	clearTimeout(keepAlive);
	assert.ok(Date.now() - t0 < 1000);
	assert.ok(seen[0].signal instanceof AbortSignal);
	// the original download gets the longer timeout
	const slow = make(async (url, init) => {
		if (url.endsWith('/api/assets/a')) return json(raw('a'));
		await new Promise((r) => setTimeout(r, 40));
		if (init.signal?.aborted) throw init.signal.reason;
		return new Response(Buffer.from('orig'), { status: 200 });
	}, { timeoutMs: 20, downloadTimeoutMs: 1000 });
	assert.equal((await slow.original('a')).bytes.toString(), 'orig');
});

test('default timeouts are 15 s for API calls and 120 s for originals', async () => {
	const seen: string[] = [];
	const orig = AbortSignal.timeout;
	(AbortSignal as any).timeout = (ms: number) => {
		seen.push(String(ms));
		return orig.call(AbortSignal, ms);
	};
	try {
		const im = make(async (url) => (url.endsWith('/api/assets/a') ? json(raw('a')) : new Response(Buffer.from('o'), { status: 200 })));
		await im.original('a');
	} finally {
		(AbortSignal as any).timeout = orig;
	}
	assert.deepEqual(seen, ['15000', '120000']);
});

test('albums maps id and name; original returns bytes and file name', async () => {
	const im = make(async (url) =>
		url.endsWith('/api/albums')
			? json([{ id: 'x', albumName: 'Hike', assetCount: 3 }])
			: url.endsWith('/api/assets/a')
				? json(raw('a'))
				: new Response(Buffer.from('orig'), { status: 200 })
	);
	assert.deepEqual(await im.albums(), [{ id: 'x', name: 'Hike' }]);
	const o = await im.original('a');
	assert.equal(o.bytes.toString(), 'orig');
	assert.equal(o.fileName, 'a.jpg');
});

test('smart search posts query and stops at the limit', async () => {
	let calls = 0;
	const im = make(async (url, init) => {
		assert.equal(url, 'http://immich.test/api/search/smart');
		assert.equal(JSON.parse(init.body).query, 'hut');
		calls++;
		return json({ assets: { items: [raw(`a${calls}`), raw(`b${calls}`)], nextPage: String(calls + 1) } });
	});
	const out = await im.smart('hut', 3);
	assert.equal(out.length, 3);
	assert.equal(calls, 2);
});

test('update sends dateTimeOriginal and coordinates in one request', async () => {
	const seen: any[] = [];
	const im = make(async (url, init) => {
		seen.push({ url, method: init.method, body: JSON.parse(init.body), key: init.headers['x-api-key'] });
		return new Response(null, { status: 204 });
	});
	await im.update('id1', { dateTimeOriginal: '2026-09-27T11:18:16+02:00', latitude: 47.5, longitude: 12.9 });
	assert.deepEqual(seen, [
		{ url: 'http://immich.test/api/assets', method: 'PUT', key: 'secret', body: { ids: ['id1'], dateTimeOriginal: '2026-09-27T11:18:16+02:00', latitude: 47.5, longitude: 12.9 } }
	]);
	await assert.rejects(() => im.update('id1', { latitude: null, longitude: null }), (e: any) => e instanceof ApiError && e.status === 400);
	assert.equal(seen.length, 1);
	await im.update('id1', { latitude: 1 });
	assert.deepEqual(seen[1].body, { ids: ['id1'], latitude: 1 });
});

test('stub mode serves fixture assets without network', async () => {
	const im = createStubImmich();
	const albums = await im.albums();
	assert.equal(albums.length, 1);
	const list = await im.search({ albumId: albums[0].id });
	assert.equal(list.length, 2);
	assert.ok(list[0].lat !== undefined && list[1].lat === undefined);
	assert.equal(list[0].takenLocal, '2026-09-27T11:18:16+02:00');
	const t = await im.thumb(list[0].id, 'thumbnail');
	assert.equal(t[0], 0xff);
	assert.equal((await im.original(list[0].id)).fileName, 'IMG_0001.jpg');
	await im.update(list[1].id, { latitude: 1, longitude: 2 });
	assert.equal((await im.asset(list[1].id)).lat, 1);
	assert.equal((await im.search({ albumId: 'nope' })).length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMapyTiles } from './mapy-tiles';

const png = (n: number) => Buffer.alloc(n, 7);

test('serves from cache, fetches once on miss (stubbed fetch), evicts past the cap', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'crm-tc-'));
	const urls: string[] = [];
	const fetchStub = (async (url: string, init: any) => {
		urls.push(url);
		assert.equal(init.headers.Cookie, 'c=1');
		return new Response(png(100), { status: 200, headers: { 'content-type': 'image/png' } });
	}) as unknown as typeof fetch;
	const tiles = createMapyTiles({ dir, capBytes: 250, fetch: fetchStub, cookie: async () => 'c=1' });
	const a = await tiles.get(13, 4, 5);
	assert.equal(a.length, 100);
	await tiles.get(13, 4, 5);
	assert.deepEqual(urls, ['https://tilecache.mapy.com/turist-en/13-4-5']);
	// two more tiles: 300 bytes > 250 cap, oldest (13-4-5) goes
	const old = new Date(Date.now() - 100000);
	utimesSync(path.join(dir, '13-4-5.png'), old, old);
	await tiles.get(13, 4, 6);
	await tiles.get(13, 4, 7);
	const left = readdirSync(dir).sort();
	assert.deepEqual(left, ['13-4-6.png', '13-4-7.png']);
	assert.ok(left.reduce((s, f) => s + statSync(path.join(dir, f)).size, 0) <= 250);
});

test('rejects bad coordinates and upstream errors', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'crm-tc-'));
	const tiles = createMapyTiles({ dir, capBytes: 1000, fetch: (async () => new Response('x', { status: 403, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch, cookie: async () => '' });
	await assert.rejects(() => tiles.get(13, -1, 5), /Bad tile/);
	await assert.rejects(() => tiles.get(13, 1, 5), /403/);
	writeFileSync(path.join(dir, 'x'), '');
});

test('parallel requests for one tile share a single fetch; other tiles fetch once each', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'crm-tc-'));
	let calls = 0;
	let cookies = 0;
	const fetchStub = (async () => {
		calls++;
		await new Promise((r) => setTimeout(r, 10));
		return new Response(png(10), { status: 200, headers: { 'content-type': 'image/png' } });
	}) as unknown as typeof fetch;
	const tiles = createMapyTiles({ dir, fetch: fetchStub, cookie: async () => (cookies++, 'c=1') });
	await Promise.all([...Array(20)].map((_, i) => tiles.get(13, 1, i % 4)));
	assert.equal(calls, 4);
	assert.equal(cookies, 4);
});

test('non-image upstream answers are 502 and not cached', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'crm-tc-'));
	const html = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
	const tiles = createMapyTiles({ dir, fetch: html, cookie: async () => '' });
	await assert.rejects(() => tiles.get(13, 1, 1), (e: any) => e.status === 502);
	assert.deepEqual(readdirSync(dir), []);
});

test('getMapyCookie: concurrent callers share one handshake', async () => {
	const { getMapyCookie } = await import('../../mapy-cookies.js');
	const real = globalThis.fetch;
	const urls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		urls.push(url);
		await new Promise((r) => setTimeout(r, 5));
		if (String(url).endsWith('/refreshCookies')) return new Response(JSON.stringify({ cookies: [{ cname: 'CloudFront-X', value: 'v' }], lifetime: 3600 }), { status: 200 });
		const h = new Headers();
		h.append('set-cookie', 'User-Id=u1; Path=/');
		return new Response('', { status: 200, headers: h });
	}) as unknown as typeof fetch;
	const log = console.log;
	console.log = () => {};
	try {
		const all = await Promise.all([...Array(20)].map(() => getMapyCookie()));
		assert.ok(all.every((c: string) => c === all[0] && c.includes('CloudFront-X=v')));
		assert.equal(urls.length, 2);
	} finally {
		globalThis.fetch = real;
		console.log = log;
	}
});

test('map-download CLI unchanged', () => {
	const r = spawnSync('node', ['scripts/map-download.js', 'nonexistent-slug'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
	assert.equal(r.status, 0);
	assert.equal(r.stderr, 'Failed to fetch /maps/nonexistent-slug metadata.\n');
});

test('counts tiles already on disk once, then keeps its own total', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'crm-tc-'));
	writeFileSync(path.join(dir, '1-1-1.png'), png(100));
	utimesSync(path.join(dir, '1-1-1.png'), new Date(Date.now() - 1e5), new Date(Date.now() - 1e5));
	writeFileSync(path.join(dir, '1-1-2.png'), png(100));
	const stub = (async () => new Response(png(100), { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
	const tiles = createMapyTiles({ dir, capBytes: 250, fetch: stub, cookie: async () => '' });
	await tiles.get(2, 2, 2); // 300 > 250: the oldest pre-existing tile goes
	await tiles.get(2, 2, 3); // 300 again: next oldest goes
	assert.deepEqual(readdirSync(dir).sort(), ['2-2-2.png', '2-2-3.png']);
});

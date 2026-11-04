import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOsmClient, createStubClient, nearestPoint, OVERPASS_URLS, QUERY_FEATURES_URL, QUERY_PAGE_URL } from './osm-client';
import { ApiError } from './errors';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const HOUR_MS = 3600_000;
/** openstreetmap.org's Query features page as in the recorded session: the token cookie, an hour past the answer's Date. */
const tokenPage = (value = '197535', served = Date.parse('2026-11-02T14:49:48Z')) =>
	new Response('<turbo-frame id="sidebar_content_frame"></turbo-frame>', {
		headers: [
			['date', new Date(served).toUTCString()],
			['set-cookie', `_osm_totp_token=${value}; domain=openstreetmap.org; path=/; expires=${new Date(served + HOUR_MS).toUTCString()}; secure; httponly; samesite=lax`]
		]
	});
/** A fetch whose openstreetmap.org Query features page hands out a token; everything else goes to `f`. */
const site = (f: (url: string, init: RequestInit) => Promise<Response>) =>
	(async (url: string, init: RequestInit = {}) => (url.startsWith(QUERY_PAGE_URL) ? tokenPage() : f(url, init))) as any;
/** A fetch where openstreetmap.org's Query features endpoint is down, so `around` takes the Overpass fallback. */
const qfDown = (f: (url: string, init: RequestInit) => Promise<Response>) => site(async (url, init) => (url === QUERY_FEATURES_URL ? json({}, 503) : f(url, init)));

function clock() {
	let t = 1_000_000;
	return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
}

test('fallback: around returns nodes, ways and relations as raw elements', async () => {
	const c = clock();
	const calls: { url: string; body: string }[] = [];
	const client = createOsmClient({
		...c,
		fetch: qfDown(async (url: string, init: RequestInit) => {
			calls.push({ url, body: String(init.body) });
			return json({ elements: [{ type: 'way', id: 2, center: { lat: 1, lon: 2 }, tags: { a: 'b' } }, { type: 'node', id: 1, lat: 1, lon: 2 }] });
		})
	});
	const els = await client.around(47.5, 11.5, 30);
	assert.deepEqual(els.map((e) => `${e.type}/${e.id}`), ['way/2', 'node/1']);
	assert.deepEqual(els[1].tags, {});
	assert.equal(calls[0].url, OVERPASS_URLS[0]);
	const ql = decodeURIComponent(calls[0].body.replace(/\+/g, ' '));
	assert.match(ql, /^data=\[out:json\]\[timeout:10\];\(node\(around:30,47\.5,11\.5\)\(if:count_tags\(\)>0\);way\(around:30,47\.5,11\.5\)/);
	assert.match(ql, /relation\(around:30,47\.5,11\.5\)\(if:count_tags\(\)>0\);\);out tags geom\(47\.49973\d*,11\.4996\d*,47\.50026\d*,11\.5003\d*\);$/);
	assert.doesNotMatch(ql, /out center/);
});

test('fallback: around places a way or relation at its clipped geometry point nearest the click, no geometry kept', async () => {
	const c = clock();
	const client = createOsmClient({
		...c,
		fetch: qfDown(async () =>
			json({
				elements: [
					{ type: 'way', id: 2, tags: { highway: 'path' }, bounds: { minlat: 0, minlon: 0, maxlat: 9, maxlon: 9 }, geometry: [{ lat: 47.6, lon: 11.6 }, null, { lat: 47.5001, lon: 11.5001 }] },
					{ type: 'relation', id: 3, tags: { route: 'bus' }, members: [{ type: 'way', ref: 7, geometry: [{ lat: 47.51, lon: 11.5 }] }, { type: 'node', ref: 8, lat: 47.5002, lon: 11.5 }] },
					{ type: 'relation', id: 4, tags: { type: 'site' }, bounds: { minlat: 47, minlon: 11, maxlat: 48, maxlon: 12 }, members: [] }
				]
			})) as any
	});
	const els = await client.around(47.5, 11.5, 30);
	assert.deepEqual(els.map((e) => e.center), [{ lat: 47.5001, lon: 11.5001 }, { lat: 47.5002, lon: 11.5 }, { lat: 47.5, lon: 11.5 }]);
	assert.ok(els.every((e) => !('geometry' in e) && !('members' in e) && !('bounds' in e)));
});

test('nearestPoint: null without geometry or bounds', () => {
	assert.equal(nearestPoint({ type: 'way' }, { lat: 1, lon: 2 }), null);
});

test('fallback: a mirror that never answers is given up on and the next is asked', async () => {
	const c = clock();
	const seen: string[] = [];
	const client = createOsmClient({
		...c,
		fetch: qfDown(async (url: string, init: RequestInit) => {
			seen.push(url);
			if (url === OVERPASS_URLS[0]) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
			assert.ok(init.signal, 'each Overpass request carries a timeout');
			return json({ elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { a: 'b' } }] });
		})
	});
	assert.equal((await client.around(1, 2, 30)).length, 1);
	assert.deepEqual(seen, OVERPASS_URLS.slice(0, 2));
});

test('fallback: all mirrors busy -> ApiError 503 with a readable message, mirrors tried in order', async () => {
	const c = clock();
	const seen: string[] = [];
	const client = createOsmClient({ ...c, fetch: qfDown(async (url: string) => (seen.push(url), json({}, 429))) as any });
	await assert.rejects(
		client.around(1, 2, 30),
		(e: unknown) => e instanceof ApiError && e.status === 503 && e.message === 'OSM is busy — try again in a minute'
	);
	assert.deepEqual(seen, OVERPASS_URLS);
});

test('a busy mirror hands over to the next', async () => {
	const c = clock();
	let n = 0;
	const client = createOsmClient({ ...c, fetch: (async () => (n++ === 0 ? json({}, 503) : json({ elements: [{ type: 'node', id: 5, lat: 1, lon: 1, tags: { x: 'y' } }] }))) as any });
	assert.equal((await client.searchName('Foo.bar', 1, 1))[0].id, 5);
});

test('elements: batches of 100, halving on 404, centre of full.json bbox, invisible skipped', async () => {
	const c = clock();
	const urls: string[] = [];
	const client = createOsmClient({
		...c,
		fetch: (async (url: string) => {
			urls.push(url);
			const u = new URL(url);
			if (u.pathname.endsWith('/nodes.json')) {
				const ids = u.searchParams.get('nodes')!.split(',');
				if (ids.includes('404')) return json({}, 404);
				return json({ elements: ids.map((id) => ({ type: 'node', id: +id, lat: 1, lon: 2, tags: { n: id }, visible: id !== '7' })) });
			}
			if (u.pathname.endsWith('/ways.json')) return json({ elements: [{ type: 'way', id: 9, nodes: [1, 2], tags: { highway: 'path' } }] });
			if (u.pathname.endsWith('/way/9/full.json'))
				return json({ elements: [{ type: 'node', id: 1, lat: 10, lon: 20 }, { type: 'node', id: 2, lat: 12, lon: 26 }, { type: 'way', id: 9 }] });
			throw new Error(url);
		}) as any
	});
	const found = await client.elements(['node/1', 'node/404', 'node/7', 'way/9']);
	assert.deepEqual(Object.keys(found).sort(), ['node/1', 'way/9']);
	assert.deepEqual(found['way/9'].center, { lat: 11, lon: 23 });
	assert.ok(urls.some((u) => u.endsWith('nodes.json?nodes=1,404,7')));
	assert.ok(urls.some((u) => u.endsWith('nodes.json?nodes=1')));

	urls.length = 0;
	await client.elements(Array.from({ length: 150 }, (_, i) => `node/${i + 1000}`));
	assert.equal(urls.filter((u) => u.includes('nodes.json')).length, 2);
});

test('requests are spaced >= 1 s (Overpass) and >= 0.5 s (OSM API)', async () => {
	const c = clock();
	const stamps: { kind: string; t: number }[] = [];
	const client = createOsmClient({
		...c,
		fetch: (async (url: string) => {
			stamps.push({ kind: url.includes('overpass') ? 'op' : 'api', t: c.now() });
			return json({ elements: [] });
		}) as any
	});
	await client.searchName('a', 1, 2);
	await client.searchName('b', 1, 2);
	await client.elements(['node/1']);
	await client.elements(['node/2']);
	const gaps = (k: string) => stamps.filter((s) => s.kind === k).map((s, i, a) => (i ? s.t - a[i - 1].t : Infinity)).slice(1);
	assert.ok(gaps('op').every((g) => g >= 1000), String(gaps('op')));
	assert.ok(gaps('api').every((g) => g >= 500), String(gaps('api')));
});

test('around asks openstreetmap.org Query features (nearby + enclosing, as the site does), not Overpass', async () => {
	const c = clock();
	const calls: { url: string; ql: string; ua: string; origin: string | null; cookie: string | null }[] = [];
	let pages = 0;
	const client = createOsmClient({
		...c,
		fetch: (async (url: string, init: RequestInit) => {
			if (url.startsWith(QUERY_PAGE_URL)) {
				assert.equal(url, `${QUERY_PAGE_URL}?lat=47.735613&lon=11.85976`);
				assert.equal(new Headers(init.headers).get('turbo-frame'), 'sidebar_content_frame');
				return (pages++, tokenPage());
			}
			const h = new Headers(init.headers);
			const ql = new URLSearchParams(String(init.body)).get('data')!;
			calls.push({ url, ql, ua: h.get('User-Agent') ?? '', origin: h.get('Origin'), cookie: h.get('Cookie') });
			if (ql.includes('is_in'))
				return json({
					elements: [
						{ type: 'way', id: 30, tags: { natural: 'water', name: 'Schliersee' }, bounds: { minlat: 47.7, minlon: 11.85, maxlat: 47.73, maxlon: 11.87 } },
						{ type: 'way', id: 30, geometry: [{ lat: 47.71, lon: 11.86 }] },
						{ type: 'relation', id: 51477, tags: { name: 'Deutschland', boundary: 'administrative' }, bounds: { minlat: 47.2, minlon: 5.8, maxlat: 55.1, maxlon: 15.1 } },
						{ type: 'relation', id: 40, tags: { route: 'bus' }, bounds: { minlat: 47.73, minlon: 11.85, maxlat: 47.74, maxlon: 11.86 } }
					]
				});
			return json({
				elements: [
					{ type: 'node', id: 1, lat: 47.7356, lon: 11.8597, tags: { railway: 'stop' } },
					{ type: 'way', id: 2, tags: { building: 'retail' }, bounds: {}, geometry: [{ lat: 47.7357, lon: 11.8598 }] },
					{ type: 'relation', id: 40, tags: { route: 'bus' }, members: [{ type: 'way', ref: 9, geometry: [{ lat: 47.7355, lon: 11.8596 }] }] }
				]
			});
		}) as any
	});
	const els = await client.around(47.735613, 11.85976, 10);
	assert.deepEqual(calls.map((x) => x.url), [QUERY_FEATURES_URL, QUERY_FEATURES_URL]);
	assert.equal(pages, 1, 'the two queries share one token fetch');
	assert.deepEqual(calls.map((x) => x.cookie), ['_osm_totp_token=197535', '_osm_totp_token=197535']);
	assert.match(calls[0].ql, /^\[timeout:10\]\[out:json\];\(node\(around:10,47\.735613,11\.85976\);way\(around:10,47\.735613,11\.85976\);\);out tags geom\([^)]+\);relation\(around:10,47\.735613,11\.85976\);out geom\([^)]+\);$/);
	assert.match(calls[1].ql, /^\[timeout:10\]\[out:json\];is_in\(47\.735613,11\.85976\)->\.a;way\(pivot\.a\);out tags bb;out ids geom\([^)]+\);relation\(pivot\.a\);out tags bb;$/);
	assert.ok(calls.every((x) => x.ua.startsWith('mykolamor.com hike CRM') && x.origin === 'https://www.openstreetmap.org'), JSON.stringify(calls.map((x) => [x.url, x.ua, x.origin])));
	assert.deepEqual(
		els.map((e) => [`${e.type}/${e.id}`, e.center ?? null, e.enclosing ?? false]),
		[
			['node/1', null, false],
			['way/2', { lat: 47.7357, lon: 11.8598 }, false],
			['relation/40', { lat: 47.7355, lon: 11.8596 }, false],
			// the lake (its two listings merged), at the click; Germany too wide; the bus route already listed nearby
			['way/30', { lat: 47.735613, lon: 11.85976 }, true]
		]
	);
	assert.equal(els[3].tags.name, 'Schliersee');
});

test('Query features failing (status, network, timeout) falls back to the Overpass mirrors; enclosing failing alone is skipped', async () => {
	const c = clock();
	for (const fail of [() => json({}, 429), () => Promise.reject(new TypeError('fetch failed')), () => json({ remark: 'no elements' })]) {
		const seen: string[] = [];
		const client = createOsmClient({
			...c,
			fetch: site(async (url: string) => (seen.push(url), url === QUERY_FEATURES_URL ? fail() : json({ elements: [{ type: 'node', id: 7, lat: 1, lon: 2, tags: { a: 'b' } }] })))
		});
		assert.deepEqual((await client.around(1, 2, 30)).map((e) => e.id), [7]);
		assert.equal(seen.at(-1), OVERPASS_URLS[0]);
	}
	const client = createOsmClient({
		...c,
		fetch: site(async (url: string, init: RequestInit) =>
			String(init.body).includes('is_in') ? json({}, 504) : json({ elements: [{ type: 'node', id: 8, lat: 1, lon: 2, tags: { a: 'b' } }] }))
	});
	assert.deepEqual((await client.around(1, 2, 30)).map((e) => e.id), [8]);
});

test('a refused or cut-short answer is logged with the start of its body', async () => {
	const c = clock();
	const logs: string[] = [];
	const page = `<html><body><h1>502 Gateway Timeout</h1>\n\nThis Overpass API server is currently at capacity. ${'x'.repeat(400)}</body></html>`;
	const client = createOsmClient({
		...c,
		log: (m) => logs.push(m),
		fetch: site(async (url: string) => {
			if (url === QUERY_FEATURES_URL) return new Response('<p>Too many requests</p>', { status: 429 });
			if (url === OVERPASS_URLS[0]) return new Response(page, { status: 502 });
			return json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 10 seconds.' });
		})
	});
	await client.around(1, 2, 30);
	assert.equal(logs[0], 'OSM Query features: answered 429: "Too many requests", asking the Overpass mirrors instead');
	assert.match(logs[1], /^Overpass overpass-api\.de busy \(502\), trying the next mirror: "502 Gateway Timeout This Overpass API server is currently at capacity\. x+…"$/);
	assert.ok(logs[1].length < 420, 'the body is cut at 300 characters');
	assert.equal(logs[2], 'Overpass overpass.private.coffee remark: "runtime error: Query timed out in \\"query\\" at line 1 after 10 seconds."');
});

test('the token is kept until a minute before its cookie expires, then fetched anew', async () => {
	const c = clock();
	const cookies: string[] = [];
	let pages = 0;
	const client = createOsmClient({
		...c,
		fetch: (async (url: string, init: RequestInit) => {
			if (url.startsWith(QUERY_PAGE_URL)) return tokenPage(String(++pages));
			cookies.push(new Headers(init.headers).get('Cookie')!);
			return json({ elements: [] });
		}) as any
	});
	await client.around(1, 2, 30);
	c.advance(HOUR_MS - 61_000);
	await client.around(1, 2, 30);
	c.advance(2_000);
	await client.around(1, 2, 30);
	assert.deepEqual(cookies, ['1', '1', '1', '1', '2', '2'].map((v) => `_osm_totp_token=${v}`));
});

test('a refused token is fetched anew and the query sent once more', async () => {
	const c = clock();
	const logs: string[] = [];
	let pages = 0;
	const client = createOsmClient({
		...c,
		log: (m) => logs.push(m),
		fetch: (async (url: string, init: RequestInit) => {
			if (url.startsWith(QUERY_PAGE_URL)) return tokenPage(String(++pages));
			if (String(init.body).includes('is_in')) return json({ elements: [] });
			const cookie = new Headers(init.headers).get('Cookie');
			return cookie === '_osm_totp_token=2' ? json({ elements: [{ type: 'node', id: 9, lat: 1, lon: 2, tags: { a: 'b' } }] }) : new Response('bad token', { status: 403 });
		}) as any
	});
	assert.deepEqual((await client.around(1, 2, 30)).map((e) => e.id), [9]);
	assert.equal(pages, 2);
	assert.equal(logs[0], 'OSM Query features refused the token (403): "bad token", fetching a new one');
});

test('no token from the site falls back to the Overpass mirrors', async () => {
	const c = clock();
	const logs: string[] = [];
	const seen: string[] = [];
	const client = createOsmClient({
		...c,
		log: (m) => logs.push(m),
		fetch: (async (url: string) => {
			seen.push(url);
			if (url.startsWith(QUERY_PAGE_URL)) return new Response('<html></html>');
			return json({ elements: [{ type: 'node', id: 7, lat: 1, lon: 2, tags: { a: 'b' } }] });
		}) as any
	});
	assert.deepEqual((await client.around(1, 2, 30)).map((e) => e.id), [7]);
	assert.ok(!seen.includes(QUERY_FEATURES_URL), 'query-features is not asked without a token');
	assert.equal(seen.at(-1), OVERPASS_URLS[0]);
	assert.equal(logs[0], 'OSM Query features: token page set no _osm_totp_token cookie, asking the Overpass mirrors instead');
});

test('stub client serves the canned fixture', async () => {
	const s = createStubClient();
	assert.equal((await s.elements(['node/900001', 'node/1']))['node/900001'].tags.name, 'Stubspitze');
	assert.equal((await s.around(0, 0, 30)).length, 3);
	assert.equal((await s.searchName('stubhütte', 0, 0)).length, 1);
});

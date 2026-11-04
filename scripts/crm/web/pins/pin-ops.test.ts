import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '../api';
import { NO_ZOOM, NUDGE, bearing16, clampView, zoomAt, escapeAction, distanceLabel, ensureInStore, pinImageSrc, pinOps, pointerFraction, rankPlaces, searchOsm, searchStore, serialRunner } from './pin-ops';

const P = [{ ref: 'node/1', x: 0.5, y: 0.5 }];

test('pin ops clamp and round to 4 decimals', () => {
	assert.deepEqual(pinOps.add(P, 'way/2', 0.123456, 1.3), [...P, { ref: 'way/2', x: 0.1235, y: 1 }]);
	assert.deepEqual(pinOps.add([], 'node/3', -0.2, 0.99999), [{ ref: 'node/3', x: 0, y: 1 }]);
	assert.deepEqual(pinOps.move(P, 0, 0.77777, -1), [{ ref: 'node/1', x: 0.7778, y: 0 }]);
	assert.deepEqual(pinOps.remove([...P, { ref: 'way/2', x: 0, y: 0 }], 0), [{ ref: 'way/2', x: 0, y: 0 }]);
	assert.deepEqual(pinOps.nudge(P, 0, 1, -1), [{ ref: 'node/1', x: 0.502, y: 0.498 }]);
	assert.deepEqual(pinOps.nudge(P, 0, 5, 0), [{ ref: 'node/1', x: 0.51, y: 0.5 }], 'Shift is five steps');
	assert.deepEqual(pinOps.nudge([{ ref: 'node/1', x: 0.999, y: 0 }], 0, 1, -1), [{ ref: 'node/1', x: 1, y: 0 }]);
	assert.equal(NUDGE, 0.002);
	// out-of-range indices change nothing; the input is never mutated
	assert.deepEqual(pinOps.move(P, 3, 0, 0), P);
	assert.deepEqual(pinOps.remove(P, -1), P);
	assert.deepEqual(P, [{ ref: 'node/1', x: 0.5, y: 0.5 }]);
});

test('pointer position maps to fractions of the letterboxed image', () => {
	const box = { left: 10, top: 20, width: 400, height: 400 };
	// a 4:2 image in a 400×400 box is drawn 400×200 at top 100
	assert.deepEqual(pointerFraction(10 + 100, 20 + 100 + 50, box, 4, 2), { x: 0.25, y: 0.25 });
	assert.equal(pointerFraction(10 + 100, 20 + 50, box, 4, 2), null, 'on the bar above the image');
	assert.deepEqual(pointerFraction(10 + 100, 20 + 50, box, 4, 2, true), { x: 0.25, y: 0 }, 'clamped while dragging');
	// zoomed 2× and panned by (-100, -150): stage point (300, 250) is unzoomed (200, 200), the photo's centre
	assert.deepEqual(pointerFraction(10 + 300, 20 + 250, box, 4, 2, false, { z: 2, x: -100, y: -150 }), { x: 0.5, y: 0.5 });
});

test('zoom keeps the point under the pointer and the photo on the stage', () => {
	const box = { width: 400, height: 400 };
	const drawn = { left: 0, top: 100, width: 400, height: 200 }; // a 2:1 photo letterboxed top and bottom
	const v = zoomAt(NO_ZOOM, 2, 100, 150, box, drawn);
	assert.deepEqual(v, { z: 2, x: -100, y: -200 }, 'x keeps (100, _) put; at 2× the photo is 400 tall and exactly fills the stage');
	assert.deepEqual(zoomAt(v, 0.25, 0, 0, box, drawn), NO_ZOOM, 'below 1× snaps back');
	assert.equal(zoomAt(v, 100, 0, 0, box, drawn).z, 8, 'capped');
	// panned past an edge: clamped to it; at 1.5× the photo is 300 tall, so it stays centred vertically
	assert.deepEqual(clampView({ z: 2, x: 50, y: -1000 }, box, drawn), { z: 2, x: 0, y: -200 });
	assert.deepEqual(clampView({ z: 1.5, x: -900, y: 0 }, box, drawn), { z: 1.5, x: -200, y: -100 });
});

test('distance and bearing labels', () => {
	const from = { lat: 47.7, lon: 11.75 };
	assert.equal(bearing16(from, { lat: 47.64, lon: 11.72 }), 'SSW');
	assert.equal(bearing16(from, { lat: 47.8, lon: 11.75 }), 'N');
	assert.equal(bearing16(from, { lat: 47.7, lon: 11.9 }), 'E');
	assert.equal(distanceLabel(from, { lat: 47.636, lon: 11.715 }), '7.6 km · SSW');
	assert.equal(distanceLabel(from, { lat: 47.701, lon: 11.75 }), '111 m · N');
	assert.equal(distanceLabel(null, { lat: 1, lon: 1 }), '');
});

test('places sort by distance from the photo; without one the hike nodes come first, from the origin', () => {
	const near = { ref: 'node/1', name: 'Near', kind: null, lat: 47.01, lon: 11, inStore: true };
	const far = { ref: 'node/2', name: 'Far', kind: null, lat: 47.5, lon: 11, inStore: false };
	const own = { ref: 'node/3', name: 'Own', kind: null, lat: 48, lon: 11, inStore: true };
	assert.deepEqual(rankPlaces([far, own, near], { lat: 47, lon: 11 }, null, []).map((p) => [p.ref, p.label]), [
		['node/1', '1.1 km · N'],
		['node/2', '55.6 km · N'],
		['node/3', '111 km · N']
	]);
	assert.deepEqual(rankPlaces([far, near, own], null, { lat: 47, lon: 11 }, ['node/3']).map((p) => p.ref), ['node/3', 'node/1', 'node/2']);
	assert.deepEqual(rankPlaces([far, near], null, null, []).map((p) => [p.ref, p.label]), [['node/2', ''], ['node/1', '']]);
});

test('picking an OSM element not in the store adds it first', async () => {
	const calls: string[] = [];
	let version = 'v1';
	let conflicts = 1;
	const request = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
		calls.push(`${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`.trim());
		if (path === '/api/osm/store/version') return { version } as T;
		if (path === '/api/osm/add') {
			if (conflicts-- > 0) {
				version = 'v2';
				throw new ApiClientError(409, 'osm.json changed on disk', { error: 'osm.json changed on disk', version: 'v2' });
			}
			return { version: 'v3', entries: {} } as T;
		}
		throw new Error('unexpected ' + path);
	};
	await ensureInStore({ ref: 'node/5', inStore: false }, request);
	assert.deepEqual(calls, [
		'GET /api/osm/store/version',
		'POST /api/osm/add {"refs":["node/5"],"base":"v1"}',
		'GET /api/osm/store/version',
		'POST /api/osm/add {"refs":["node/5"],"base":"v2"}'
	]);
	// in the store already: no calls
	calls.length = 0;
	await ensureInStore({ ref: 'node/1', inStore: true }, request);
	assert.deepEqual(calls, []);
	// a second conflict is given up on
	conflicts = 2;
	await assert.rejects(ensureInStore({ ref: 'node/6', inStore: false }, request), (e) => e instanceof ApiClientError && e.status === 409);
});

test('the write runner runs one write at a time, in order, and goes on after a failure', async () => {
	const run = serialRunner();
	const log: string[] = [];
	let open = 0;
	const write = (name: string, fail = false) => async () => {
		open++;
		assert.equal(open, 1, 'never two writes at once');
		log.push(`start ${name}`);
		await new Promise((r) => setTimeout(r, 5));
		log.push(`end ${name}`);
		open--;
		if (fail) throw new Error(name + ' failed');
		return name;
	};
	const pins = run(write('pins'));
	const caption = run(write('caption', true));
	const more = run(write('pins again'));
	assert.equal(await pins, 'pins');
	await assert.rejects(caption, /caption failed/);
	assert.equal(await more, 'pins again');
	assert.deepEqual(log, ['start pins', 'end pins', 'start caption', 'end caption', 'start pins again', 'end pins again']);
	assert.equal(await run(async () => 'idle'), 'idle');
});

test('Esc: cancels a new pin first, then blurs a caption with unsaved text (keeping it), else closes', () => {
	assert.equal(escapeAction({ pending: true, inCaption: true, captionDirty: true }), 'cancel-pin');
	assert.equal(escapeAction({ pending: false, inCaption: true, captionDirty: true }), 'blur');
	// a second Esc (focus has left the caption) closes
	assert.equal(escapeAction({ pending: false, inCaption: false, captionDirty: true }), 'close');
	assert.equal(escapeAction({ pending: false, inCaption: true, captionDirty: false }), 'close');
	assert.equal(escapeAction({ pending: false, inCaption: false, captionDirty: false }), 'close');
});

test('pin image: the largest tier up to 1280 that exists, else the href', () => {
	const href = '/images/x/2024-01-01-00.jpg';
	assert.equal(pinImageSrc(href, 4000, 3000), '/images/x/2024-01-01-00-1280.avif');
	assert.equal(pinImageSrc(href, 1000, 800), '/images/x/2024-01-01-00-640.avif');
	assert.equal(pinImageSrc(href, 600, 1279), '/images/x/2024-01-01-00-640.avif');
	assert.equal(pinImageSrc(href, 500, 400), href, 'below 640 there are no tiers');
	assert.equal(pinImageSrc(href, 4000, 3000, 2560), '/images/x/2024-01-01-00-2560.avif', 'zoomed in: a bigger tier');
	assert.equal(pinImageSrc(href, undefined, undefined), '/images/x/2024-01-01-00-1280.avif', 'size unknown: try 1280 (the img falls back on error)');
});

const place = (ref: string, inStore: boolean) => ({ ref, name: ref, kind: null, lat: 47, lon: 11, inStore });

test('the store search asks only the store', async () => {
	const calls: string[] = [];
	const request = async <T,>(_method: string, path: string): Promise<T> => (calls.push(path), { store: [place('node/1', true)], osm: [] } as T);
	assert.deepEqual((await searchStore('hut', request)).map((i) => i.ref), ['node/1']);
	assert.deepEqual(calls, ['/api/osm/search?q=hut&source=store']);
});

test('the OSM search adds to what is listed, without repeats', async () => {
	const calls: string[] = [];
	const request = async <T,>(_method: string, path: string): Promise<T> => (calls.push(path), { store: [], osm: [place('node/1', true), place('node/2', false)] } as T);
	const r = await searchOsm('hut', { lat: 47, lon: 11 }, [place('node/1', true)], request);
	assert.deepEqual(calls, ['/api/osm/search?q=hut&source=osm&lat=47&lon=11']);
	assert.deepEqual(r.items.map((i) => i.ref), ['node/1', 'node/2']);
	assert.equal(r.osmError, null);
});

test('a pasted id already in the store comes back as a store result of the OSM search', async () => {
	const request = async <T,>(): Promise<T> => ({ store: [place('node/3', true)], osm: [] } as T);
	assert.deepEqual((await searchOsm('node/3', null, [], request)).items.map((i) => i.ref), ['node/3']);
});

test('a failed OSM search keeps what is listed and reports why', async () => {
	const thrown = async <T,>(): Promise<T> => {
		throw new ApiClientError(404, 'OSM has no node/9', {});
	};
	const r = await searchOsm('node/9', null, [place('node/1', true)], thrown);
	assert.deepEqual(r.items.map((i) => i.ref), ['node/1']);
	assert.equal(r.osmError, 'OSM has no node/9');
	const busy = async <T,>(): Promise<T> => ({ store: [], osm: [], osm_error: 'OSM is busy' } as T);
	assert.equal((await searchOsm('hut', null, [], busy)).osmError, 'OSM is busy');
});

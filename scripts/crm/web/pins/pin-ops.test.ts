import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '../api';
import { escapeAction, ensureInStore, pinOps, pointerFraction, serialRunner } from './pin-ops';

const P = [{ ref: 'node/1', x: 0.5, y: 0.5 }];

test('pin ops clamp and round to 4 decimals', () => {
	assert.deepEqual(pinOps.add(P, 'way/2', 0.123456, 1.3), [...P, { ref: 'way/2', x: 0.1235, y: 1 }]);
	assert.deepEqual(pinOps.add([], 'node/3', -0.2, 0.99999), [{ ref: 'node/3', x: 0, y: 1 }]);
	assert.deepEqual(pinOps.move(P, 0, 0.77777, -1), [{ ref: 'node/1', x: 0.7778, y: 0 }]);
	assert.deepEqual(pinOps.remove([...P, { ref: 'way/2', x: 0, y: 0 }], 0), [{ ref: 'way/2', x: 0, y: 0 }]);
	assert.deepEqual(pinOps.nudge([{ ref: 'node/1', x: 0.999, y: 0 }], 0, 1, -1), [{ ref: 'node/1', x: 1, y: 0 }]);
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
});

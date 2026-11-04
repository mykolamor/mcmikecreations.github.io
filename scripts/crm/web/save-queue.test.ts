import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue, type SendResult } from './save-queue';
import type { FieldOp } from '../shared/ops';

function harness(results: (() => Promise<SendResult>)[] = []) {
	let t = 0;
	let timer: { at: number; fn: () => void } | null = null;
	const sent: FieldOp[][] = [];
	const q = createSaveQueue({
		send: async (ops) => {
			sent.push(ops);
			const r = results.shift();
			return r ? r() : { conflict: false };
		},
		now: () => t,
		setTimer: (fn, ms) => {
			timer = { at: t + ms, fn };
			return timer;
		},
		clearTimer: (h) => {
			if (timer === h) timer = null;
		}
	});
	const advance = async (ms: number) => {
		t += ms;
		if (timer && timer.at <= t) {
			const fn = timer.fn;
			timer = null;
			fn();
		}
		await q.idle();
	};
	return { q, sent, advance, hasTimer: () => timer !== null };
}

test('text ops debounce 800 ms and coalesce per field', async () => {
	const { q, sent, advance } = harness();
	q.queue({ field: 'post.title', value: 'A' }, { debounce: true });
	await advance(500);
	q.queue({ field: 'post.title', value: 'AB' }, { debounce: true });
	q.queue({ field: 'sidecar.name', value: 'N' }, { debounce: true });
	await advance(799);
	assert.equal(sent.length, 0);
	assert.equal(q.status, 'saving');
	await advance(1);
	assert.deepEqual(sent, [[{ field: 'post.title', value: 'AB' }, { field: 'sidecar.name', value: 'N' }]]);
	assert.equal(q.status, 'saved');
	assert.equal(q.lastSavedAt, 1300);
});

test('flush sends immediately', async () => {
	const { q, sent, hasTimer } = harness();
	q.queue({ field: 'post.title', value: 'A' }, { debounce: true });
	await q.flush();
	assert.equal(sent.length, 1);
	assert.equal(hasTimer(), false);
	assert.equal(q.status, 'saved');
});

test('chips ops send without debounce', async () => {
	const { q, sent } = harness();
	q.queue({ field: 'post.tags', value: ['x'] }, { debounce: false });
	await q.idle();
	assert.deepEqual(sent, [[{ field: 'post.tags', value: ['x'] }]]);
});

test('409 sets conflict and keeps pending ops', async () => {
	const doc = { version: 'v2' };
	const { q, sent } = harness([async () => ({ conflict: true, doc })]);
	q.queue({ field: 'post.title', value: 'A' }, { debounce: false });
	await q.idle();
	assert.equal(q.status, 'conflict');
	assert.equal(q.conflictDoc, doc);
	assert.deepEqual(q.pending(), [{ field: 'post.title', value: 'A' }]);
	await q.flush();
	assert.equal(sent.length, 1, 'stops sending while in conflict');
	q.resolve('overwrite');
	await q.idle();
	assert.equal(sent.length, 2);
	assert.equal(q.status, 'saved');
	assert.deepEqual(q.pending(), []);
});

test('discard drops pending ops and clears conflict', async () => {
	const { q } = harness([async () => ({ conflict: true, doc: {} })]);
	q.queue({ field: 'post.title', value: 'A' }, { debounce: false });
	await q.idle();
	q.resolve('discard');
	assert.equal(q.status, 'saved');
	assert.deepEqual(q.pending(), []);
});

test('send failure sets error and keeps ops for retry', async () => {
	const { q, sent } = harness([async () => { throw new Error('boom'); }]);
	q.queue({ field: 'post.title', value: 'A' }, { debounce: false });
	await q.idle();
	assert.equal(q.status, 'error');
	await q.flush();
	assert.equal(sent.length, 2);
	assert.equal(q.status, 'saved');
});

test('ops queued while a send is in flight go out afterwards, none lost or duplicated', async () => {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const { q, sent } = harness([async () => (await gate, { conflict: false })]);
	q.queue({ field: 'post.title', value: 'A' }, { debounce: false });
	await Promise.resolve();
	q.queue({ field: 'post.title', value: 'B' }, { debounce: false });
	q.queue({ field: 'sidecar.name', value: 'N' }, { debounce: false });
	release();
	await q.idle();
	await q.idle();
	assert.deepEqual(sent, [
		[{ field: 'post.title', value: 'A' }],
		[{ field: 'post.title', value: 'B' }, { field: 'sidecar.name', value: 'N' }]
	]);
	assert.deepEqual(q.pending(), []);
	assert.equal(q.status, 'saved');
});

test('queue() during conflict keeps the op, does not send, and stays in conflict', async () => {
	const { q, sent } = harness([async () => ({ conflict: true, doc: {} })]);
	q.queue({ field: 'post.title', value: 'A' }, { debounce: false });
	await q.idle();
	q.queue({ field: 'post.title', value: 'B' }, { debounce: false });
	q.queue({ field: 'sidecar.name', value: 'N' }, { debounce: true });
	await q.idle();
	assert.equal(sent.length, 1);
	assert.equal(q.status, 'conflict');
	assert.deepEqual(q.pending(), [{ field: 'post.title', value: 'B' }, { field: 'sidecar.name', value: 'N' }]);
});

test('pause holds and coalesces queued ops; resume sends them once', async () => {
	const h = harness();
	h.q.pause();
	h.q.queue({ field: 'a', value: 1 }, { debounce: false });
	h.q.queue({ field: 'a', value: 2 }, { debounce: false });
	h.q.queue({ field: 'b', value: 3 }, { debounce: true });
	await h.q.flush();
	assert.equal(h.sent.length, 0);
	assert.equal(h.q.status, 'saving');
	h.q.resume();
	await h.q.idle();
	assert.deepEqual(h.sent, [[{ field: 'a', value: 2 }, { field: 'b', value: 3 }]]);
	assert.equal(h.q.status, 'saved');
});

test('an op the server rejects with 400 is dropped and reported, not retried', async () => {
	let calls = 0;
	const q = createSaveQueue({
		send: async () => {
			calls++;
			throw Object.assign(new Error('Unknown field'), { status: 400 });
		},
		setTimer: () => null,
		clearTimer: () => {}
	});
	q.queue({ field: 'post.updated', value: 'x' }, { debounce: false });
	await q.idle();
	assert.equal(calls, 1);
	assert.equal(q.status, 'error');
	assert.match(q.error!, /Unknown field/);
	assert.equal(q.pending().length, 0);
	await q.flush();
	assert.equal(calls, 1);
});

test('facts ops keep their order; only a repeat on the same path right after coalesces', async () => {
	const { q, sent, advance } = harness([async () => { throw new Error('offline'); }]);
	const note = (value: string): FieldOp => ({ kind: 'facts', scope: 'hike', path: ['legs', 0, 'note'], value: { en: value } });
	const drop: FieldOp = { kind: 'facts', scope: 'hike', path: ['legs', 1], remove: true };
	q.queue(note('A'), { debounce: true });
	q.queue(note('AB'), { debounce: true });
	q.queue(drop, { debounce: true });
	q.queue(drop, { debounce: true });
	q.queue(note('C'), { debounce: true });
	q.queue({ kind: 'facts', scope: 'post', path: ['legs', 0, 'note'], value: { en: 'P' } }, { debounce: true });
	await advance(800);
	const want = [note('AB'), drop, drop, note('C'), { kind: 'facts', scope: 'post', path: ['legs', 0, 'note'], value: { en: 'P' } }];
	assert.deepEqual(sent, [want]);
	// A failed send puts them back ahead of what was queued meanwhile, in their order.
	q.queue({ kind: 'facts', scope: 'hike', path: ['drones'], value: { en: 'No' } }, { debounce: true });
	assert.deepEqual(q.pending(), [...want, { kind: 'facts', scope: 'hike', path: ['drones'], value: { en: 'No' } }]);
});

test('inFlight is the batch being sent, and nothing once it is answered or fails', async () => {
	let answer!: (r: SendResult) => void;
	let fail!: (e: unknown) => void;
	const q = createSaveQueue({
		send: () => new Promise<SendResult>((res, rej) => ((answer = res), (fail = rej))),
		setTimer: () => 0,
		clearTimer: () => {}
	});
	const a: FieldOp = { kind: 'facts', scope: 'hike', path: ['summary'], value: { en: 'A' } };
	const b: FieldOp = { kind: 'facts', scope: 'hike', path: ['summary'], value: { en: 'AB' } };
	// What a listener sees at each change: the op is always queued or in flight until the save answers.
	const seen: number[] = [];
	q.subscribe(() => seen.push(q.inFlight().length + q.pending().length));
	q.queue(a, { debounce: true });
	q.queue(b, { debounce: true });
	assert.deepEqual(q.inFlight(), [], 'a replaced op was never sent');
	const sending = q.flush();
	await Promise.resolve();
	assert.deepEqual(q.inFlight(), [b]);
	answer({ conflict: false });
	await sending;
	assert.deepEqual(q.inFlight(), []);
	assert.deepEqual(seen, [1, 1, 1, 0]);
	q.queue(a, { debounce: false });
	await Promise.resolve();
	assert.deepEqual(q.inFlight(), [a]);
	fail(new Error('offline'));
	await q.idle();
	assert.deepEqual(q.inFlight(), []);
	assert.deepEqual(q.pending(), [a], 'put back in the queue');
});

test('a German text queues apart from the English of the same field', async () => {
	const { q, sent, advance } = harness();
	q.queue({ field: 'sidecar.name', value: 'N' }, { debounce: true });
	q.queue({ field: 'sidecar.name', lang: 'de', value: 'Ň' }, { debounce: true });
	q.queue({ field: 'sidecar.name', lang: 'de', value: 'Ňa' }, { debounce: true });
	await advance(800);
	assert.deepEqual(sent, [[{ field: 'sidecar.name', value: 'N' }, { field: 'sidecar.name', lang: 'de', value: 'Ňa' }]]);
});

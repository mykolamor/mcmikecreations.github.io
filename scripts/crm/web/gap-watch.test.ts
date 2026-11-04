import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownWrites } from './api';
import { createGapWatch } from './gap-watch';

const ref = { kind: 'post', slug: 'foo', date: '2026-07-19' } as const;
const flush = () => new Promise((r) => setTimeout(r));

test('asks once at the start, then only a tick after a change has settled', async () => {
	const asked: string[] = [];
	const shown: unknown[] = [];
	let version = 'v1';
	const request = async <T,>(_m: string, path: string): Promise<T> => (asked.push(path), { gaps: { de: ['text'] } } as T);
	const w = createGapWatch(ref, () => version, (g) => shown.push(g), request);
	await flush();
	assert.deepEqual(asked, ['/api/translation-gaps?slug=foo&date=2026-07-19']);
	assert.deepEqual(shown, [{ de: ['text'] }]);

	w.tick();
	await flush();
	assert.equal(asked.length, 1, 'nothing changed');

	version = 'v2';
	w.tick();
	await flush();
	assert.equal(asked.length, 1, 'just changed: a write may still be running');
	w.tick();
	await flush();
	assert.equal(asked.length, 2, 'settled');

	ownWrites.count++;
	w.tick();
	ownWrites.count++;
	w.tick();
	await flush();
	assert.equal(asked.length, 2, 'still writing');
	w.tick();
	await flush();
	assert.equal(asked.length, 3);
});

test('a failed read keeps what is shown', async () => {
	const shown: unknown[] = [];
	const request = async <T,>(): Promise<T> => {
		throw new Error('down');
	};
	createGapWatch(ref, () => 'v', (g) => shown.push(g), request);
	await flush();
	assert.deepEqual(shown, []);
});

test('an older answer never replaces a newer one', async () => {
	const answers: ((v: unknown) => void)[] = [];
	const request = <T,>(): Promise<T> => new Promise((r) => answers.push(r as (v: unknown) => void));
	const shown: unknown[] = [];
	let version = 'v1';
	const w = createGapWatch(ref, () => version, (g) => shown.push(g), request);
	version = 'v2';
	w.tick();
	w.tick();
	answers[1]({ gaps: { de: ['facts'] } });
	await flush();
	answers[0]({ gaps: { de: ['text'] } });
	await flush();
	assert.deepEqual(shown, [{ de: ['facts'] }]);
});

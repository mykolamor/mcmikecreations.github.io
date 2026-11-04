import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '../api';
import { addRef, refreshRef, saveLocal, StoreChangedError } from './osm-store';

type Call = [string, string, any];
function fake(script: (c: Call, n: number) => unknown) {
	const calls: Call[] = [];
	const request = async (method: string, path: string, body?: unknown) => {
		calls.push([method, path, body]);
		const r = script([method, path, body], calls.length);
		if (r instanceof Error) throw r;
		return r as any;
	};
	return { request, calls };
}
const stale = (v: string) => new ApiClientError(409, 'osm.json changed on disk', { error: 'x', version: v });

test('addRef reads the version, posts, and retries once with the version a 409 returns', async () => {
	let posts = 0;
	const f = fake(([m, p]) => (p.endsWith('/version') ? { version: 'v1' } : ++posts === 1 ? stale('v2') : { version: 'v3', entries: {} }));
	assert.equal(await addRef('node/1', f.request), true);
	assert.deepEqual(f.calls.filter((c) => c[0] === 'POST').map((c) => c[2]), [{ refs: ['node/1'], base: 'v1' }, { refs: ['node/1'], base: 'v2' }]);
});

test('addRef without a conflict does not retry', async () => {
	const f = fake(([, p]) => (p.endsWith('/version') ? { version: 'v1' } : { version: 'v2', entries: {} }));
	assert.equal(await addRef('node/1', f.request), false);
	assert.equal(f.calls.length, 2);
});

test('refreshRef retries once on 409 and returns the result', async () => {
	let posts = 0;
	const res = { version: 'v3', entry: {}, diff: { added: {}, removed: {}, changed: {} }, redundantLocal: [] };
	const f = fake(([, p]) => (p.endsWith('/version') ? { version: 'v1' } : ++posts === 1 ? stale('v2') : res));
	const out = await refreshRef('node/1', f.request);
	assert.equal(out.retried, true);
	assert.deepEqual(out.result, res);
});

test('saveLocal sends the store version it was given; a 409 is a StoreChangedError with the new version, no retry', async () => {
	const f = fake(() => stale('v9'));
	await assert.rejects(saveLocal('node/1', { a: 'b' }, 'v1', f.request), (e: unknown) => e instanceof StoreChangedError && e.version === 'v9');
	assert.equal(f.calls.length, 1);
	assert.deepEqual(f.calls[0], ['PATCH', '/api/osm/local', { ref: 'node/1', local: { a: 'b' }, base: 'v1' }]);
});

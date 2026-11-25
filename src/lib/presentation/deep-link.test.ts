import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './order';
import { parseHash } from './deep-link';

const p = normalize({ name: 'demo', slides: [{ name: 'intro' }, { name: 'bars', states: [{ name: 'grow' }, { name: 'highlight' }] }] });

test('parseHash reads names or 1-based indices and rejects anything else', () => {
	assert.deepEqual(parseHash('#demo/bars/highlight', p), { slide: 1, state: 1 });
	assert.deepEqual(parseHash('#demo/2/1', p), { slide: 1, state: 0 });
	assert.deepEqual(parseHash('#demo/bars', p), { slide: 1 });
	assert.deepEqual(parseHash('demo/intro', p), { slide: 0 });
	for (const bad of ['', '#demo', '#other/bars', '#demo/nope', '#demo/0', '#demo/3', '#demo/bars/3']) assert.equal(parseHash(bad, p), null, bad);
	const q = normalize({ name: 'a b', slides: [{ name: 'x y' }] });
	assert.deepEqual(parseHash('#a%20b/x%20y', q), { slide: 0 });
	assert.equal(parseHash('#%E0%A4%A', q), null);
});

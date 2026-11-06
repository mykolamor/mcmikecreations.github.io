import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './order';
import { parseHash } from './deep-link';

const p = normalize({ name: 'demo', slides: [{ name: 'intro' }, { name: 'bars', states: [{ name: 'grow' }, { name: 'highlight' }] }] });

test('parseHash', () => {
	assert.deepEqual(parseHash('#demo/bars/highlight', p), { slide: 1, state: 1 });
	assert.deepEqual(parseHash('#demo/2/1', p), { slide: 1, state: 0 });
	assert.deepEqual(parseHash('#demo/2/2', p), { slide: 1, state: 1 });
	assert.deepEqual(parseHash('#demo/bars', p), { slide: 1 });
	assert.deepEqual(parseHash('#demo', p), null);
	assert.equal(parseHash('#other/bars', p), null);
	assert.equal(parseHash('#demo/nope', p), null);
	assert.equal(parseHash('#demo/3', p), null);
	assert.equal(parseHash('#demo/0', p), null);
	assert.equal(parseHash('#demo/bars/nope', p), null);
	assert.equal(parseHash('#demo/bars/3', p), null);
	assert.equal(parseHash('', p), null);
	assert.deepEqual(parseHash('demo/intro', p), { slide: 0 });
});

test('parseHash decodes segments', () => {
	const q = normalize({ name: 'a b', slides: [{ name: 'x y' }] });
	assert.deepEqual(parseHash('#a%20b/x%20y', q), { slide: 0 });
	assert.equal(parseHash('#%E0%A4%A', q), null);
});

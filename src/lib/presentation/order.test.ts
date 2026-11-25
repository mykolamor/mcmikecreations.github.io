import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, neighbour } from './order';

const def = { name: 'demo', slides: [
	{ name: 'intro', states: 2 },
	{ name: 'bars', states: [{ name: 'grow' }, { name: 'highlight' }] },
	{ states: 1 },
] };
test('normalize rejects duplicates and empty slides', () => {
	assert.throws(() => normalize({ slides: [{ name: 'a' }, { name: 'a' }] }), /a/);
	assert.throws(() => normalize({ slides: [{ states: [{ name: 'x' }, { name: 'x' }] }] }), /x/);
	assert.throws(() => normalize({ slides: [{ states: 0 }] }));
	assert.throws(() => normalize({ slides: [] }));
});
test('neighbour crosses slides; backward lands on last state', () => {
	const p = normalize(def);
	assert.deepEqual(neighbour(p, { slide: 0, state: 1 }, 1), { slide: 1, state: 0 });
	assert.deepEqual(neighbour(p, { slide: 1, state: 0 }, -1), { slide: 0, state: 1 });
	assert.equal(neighbour(p, { slide: 0, state: 0 }, -1), null);
	assert.equal(neighbour(p, { slide: 2, state: 0 }, 1), null);
});

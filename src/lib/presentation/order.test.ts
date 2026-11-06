import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, resolve, neighbour, adjacency, initialPosition } from './order';

const def = { name: 'demo', slides: [
	{ name: 'intro', states: 2 },
	{ name: 'bars', states: [{ name: 'grow' }, { name: 'highlight' }] },
	{ states: 1 },
] };
test('normalize expands state counts and keeps names', () => {
	const p = normalize(def);
	assert.equal(p.name, 'demo');
	assert.deepEqual(p.slides.map((s) => s.states.length), [2, 2, 1]);
});
test('normalize rejects duplicates and empty slides', () => {
	assert.throws(() => normalize({ slides: [{ name: 'a' }, { name: 'a' }] }), /a/);
	assert.throws(() => normalize({ slides: [{ states: [{ name: 'x' }, { name: 'x' }] }] }), /x/);
	assert.throws(() => normalize({ slides: [{ states: 0 }] }));
	assert.throws(() => normalize({ slides: [] }));
});
test('resolve by name and index', () => {
	const p = normalize(def);
	assert.deepEqual(resolve(p, { slide: 'bars', state: 'highlight' }), { slide: 1, state: 1 });
	assert.deepEqual(resolve(p, { slide: 2 }), { slide: 2, state: 0 });
	assert.equal(resolve(p, { slide: 'nope' }), null);
	assert.equal(resolve(p, { slide: 0, state: 5 }), null);
});
test('neighbour crosses slides; backward lands on last state', () => {
	const p = normalize(def);
	assert.deepEqual(neighbour(p, { slide: 0, state: 1 }, 1), { slide: 1, state: 0 });
	assert.deepEqual(neighbour(p, { slide: 1, state: 0 }, -1), { slide: 0, state: 1 });
	assert.equal(neighbour(p, { slide: 0, state: 0 }, -1), null);
	assert.equal(neighbour(p, { slide: 2, state: 0 }, 1), null);
});
test('adjacency', () => {
	const p = normalize(def);
	assert.equal(adjacency(p, { slide: 0, state: 1 }, { slide: 1, state: 0 }), 1);
	assert.equal(adjacency(p, { slide: 1, state: 0 }, { slide: 0, state: 1 }), -1);
	assert.equal(adjacency(p, { slide: 0, state: 0 }, { slide: 1, state: 1 }), 0);
});
test('initialPosition takes the first source that resolves', () => {
	const p = normalize(def);
	assert.deepEqual(initialPosition(p, [{ slide: 'nope' }, { slide: 'bars', state: 1 }]), { slide: 1, state: 1 });
	assert.deepEqual(initialPosition(p, [null, undefined]), { slide: 0, state: 0 });
});

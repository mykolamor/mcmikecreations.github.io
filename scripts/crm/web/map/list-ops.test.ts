import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveItem, moveTo, removeAt } from './list-ops';

test('moveItem swaps neighbours; at the ends it is a no-op returning the same list', () => {
	const l = ['a', 'b', 'c'];
	assert.deepEqual(moveItem(l, 1, -1), ['b', 'a', 'c']);
	assert.deepEqual(moveItem(l, 1, 1), ['a', 'c', 'b']);
	assert.equal(moveItem(l, 0, -1), l);
	assert.equal(moveItem(l, 2, 1), l);
	assert.deepEqual(l, ['a', 'b', 'c']);
});

test('moveTo drags an item to a new index; same index is a no-op', () => {
	const l = ['a', 'b', 'c', 'd'];
	assert.deepEqual(moveTo(l, 0, 2), ['b', 'c', 'a', 'd']);
	assert.deepEqual(moveTo(l, 3, 1), ['a', 'd', 'b', 'c']);
	assert.equal(moveTo(l, 2, 2), l);
	assert.equal(moveTo(l, 9, 0), l);
});

test('removeAt keeps the order of the rest and ignores a bad index', () => {
	const l = ['a', 'b', 'c'];
	assert.deepEqual(removeAt(l, 1), ['a', 'c']);
	assert.equal(removeAt(l, 5), l);
});

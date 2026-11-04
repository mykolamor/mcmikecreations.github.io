import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listKey } from './list-keys';

test('arrows move within bounds, Enter chooses the active row', () => {
	assert.deepEqual(listKey('ArrowDown', false, 0, 3), { active: 1, choose: false, prevent: true });
	assert.equal(listKey('ArrowDown', false, 2, 3).active, 2);
	assert.equal(listKey('ArrowUp', false, 0, 3).active, 0);
	assert.deepEqual(listKey('Enter', false, 1, 3), { active: 1, choose: true, prevent: true });
	assert.equal(listKey('Enter', false, 0, 0).choose, false);
});

test('keys from a button are ignored (Enter on Checkpoint must not add a node)', () => {
	assert.deepEqual(listKey('Enter', true, 1, 3), { active: 1, choose: false, prevent: false });
	assert.equal(listKey('ArrowDown', true, 0, 3).active, 0);
});

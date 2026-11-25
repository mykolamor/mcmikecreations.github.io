import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listKey } from './list-keys';

test('keys from a button are ignored (Enter on Checkpoint must not add a node)', () => {
	assert.deepEqual(listKey('Enter', false, 1, 3), { active: 1, choose: true, prevent: true });
	assert.deepEqual(listKey('Enter', true, 1, 3), { active: 1, choose: false, prevent: false });
	assert.equal(listKey('ArrowDown', true, 0, 3).active, 0);
});

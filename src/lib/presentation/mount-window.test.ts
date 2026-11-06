import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountWindow } from './mount-window';

test('mountWindow', () => {
	assert.deepEqual(mountWindow(0, 3), [0, 1]);
	assert.deepEqual(mountWindow(1, 3), [0, 1, 2]);
	assert.deepEqual(mountWindow(2, 3), [1, 2]);
	assert.deepEqual(mountWindow(0, 1), [0]);
	assert.deepEqual(mountWindow(5, 10), [4, 5, 6]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick } from './localize';

test('pick', () => {
	assert.equal(pick({ en: 'Hi', de: 'Hallo' }, 'uk'), 'Hi');
	assert.equal(pick({ en: 'Hi', de: 'Hallo' }, 'de'), 'Hallo');
	assert.equal(pick('plain', 'de'), 'plain');
	assert.equal(pick(5, 'de'), 5);
	assert.equal(pick(null, 'de'), null);
	const arr = ['a'];
	assert.equal(pick(arr, 'de'), arr);
	const obj = { x: 1 };
	assert.equal(pick(obj, 'de'), obj);
});

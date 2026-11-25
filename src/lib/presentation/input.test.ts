import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyCommand, gridMove } from './input';

test('keyCommand: shift+space goes back, modifier combos stay with the browser', () => {
	assert.equal(keyCommand({ key: ' ' }), 'next');
	assert.equal(keyCommand({ key: ' ', shiftKey: true }), 'prev');
	assert.equal(keyCommand({ key: 'ArrowRight', ctrlKey: true }), null);
	assert.equal(keyCommand({ key: 'g', metaKey: true }), null);
	assert.equal(keyCommand({ key: 'f', altKey: true }), null);
});

test('gridMove clamps to a shorter row and stops at the edges', () => {
	const rows = [4, 2];
	assert.deepEqual(gridMove({ slide: 0, state: 3 }, 'ArrowDown', rows), { slide: 1, state: 1 });
	assert.deepEqual(gridMove({ slide: 1, state: 1 }, 'ArrowUp', rows), { slide: 0, state: 1 });
	assert.equal(gridMove({ slide: 0, state: 0 }, 'ArrowUp', rows), null);
	assert.equal(gridMove({ slide: 0, state: 3 }, 'ArrowRight', rows), null);
});

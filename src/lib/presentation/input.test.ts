import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyCommand, swipeCommand, gridMove } from './input';

test('keyCommand maps keys', () => {
	assert.equal(keyCommand({ key: 'ArrowRight' }), 'next');
	assert.equal(keyCommand({ key: 'PageDown' }), 'next');
	assert.equal(keyCommand({ key: ' ' }), 'next');
	assert.equal(keyCommand({ key: 'ArrowLeft' }), 'prev');
	assert.equal(keyCommand({ key: 'PageUp' }), 'prev');
	assert.equal(keyCommand({ key: ' ', shiftKey: true }), 'prev');
	assert.equal(keyCommand({ key: 'Home' }), 'first');
	assert.equal(keyCommand({ key: 'End' }), 'last');
	assert.equal(keyCommand({ key: 'g' }), 'grid');
	assert.equal(keyCommand({ key: 'G' }), 'grid');
	assert.equal(keyCommand({ key: 'f' }), 'fullscreen');
	assert.equal(keyCommand({ key: 'F' }), 'fullscreen');
	assert.equal(keyCommand({ key: 'Escape' }), 'escape');
	assert.equal(keyCommand({ key: 'x' }), null);
});

test('keyCommand ignores modifier combos', () => {
	assert.equal(keyCommand({ key: 'ArrowRight', ctrlKey: true }), null);
	assert.equal(keyCommand({ key: 'g', metaKey: true }), null);
	assert.equal(keyCommand({ key: 'f', altKey: true }), null);
});

test('swipeCommand', () => {
	assert.equal(swipeCommand(-80, 10, 300), 'next');
	assert.equal(swipeCommand(80, 10, 300), 'prev');
	assert.equal(swipeCommand(80, 70, 300), null);
	assert.equal(swipeCommand(-80, 0, 1200), null);
	assert.equal(swipeCommand(-49, 0, 100), null);
	assert.equal(swipeCommand(-50, 0, 800), 'next');
});

test('gridMove', () => {
	const rows = [4, 2];
	assert.deepEqual(gridMove({ slide: 0, state: 3 }, 'ArrowDown', rows), { slide: 1, state: 1 });
	assert.equal(gridMove({ slide: 0, state: 0 }, 'ArrowUp', rows), null);
	assert.equal(gridMove({ slide: 1, state: 0 }, 'ArrowDown', rows), null);
	assert.deepEqual(gridMove({ slide: 0, state: 1 }, 'ArrowRight', rows), { slide: 0, state: 2 });
	assert.equal(gridMove({ slide: 0, state: 3 }, 'ArrowRight', rows), null);
	assert.equal(gridMove({ slide: 0, state: 0 }, 'ArrowLeft', rows), null);
	assert.deepEqual(gridMove({ slide: 1, state: 1 }, 'ArrowUp', rows), { slide: 0, state: 1 });
	assert.equal(gridMove({ slide: 0, state: 0 }, 'x', rows), null);
});

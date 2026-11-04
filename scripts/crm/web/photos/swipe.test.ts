import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swipeAction, swipeDir, SWIPE_MIN_PX } from './swipe';

test('threshold is 40 px', () => {
	assert.equal(SWIPE_MIN_PX, 40);
	assert.equal(swipeDir(39, 0), null);
	assert.equal(swipeDir(-39.9, 10), null);
	assert.equal(swipeDir(40, 0), 'right');
	assert.equal(swipeDir(-40, 0), 'left');
	assert.equal(swipeDir(0, 40), 'down');
	assert.equal(swipeDir(0, -40), 'up');
});

test('the dominant axis decides', () => {
	assert.equal(swipeDir(60, 50), 'right');
	assert.equal(swipeDir(-50, 60), 'down');
	assert.equal(swipeDir(-70, -45), 'left');
	assert.equal(swipeDir(10, -80), 'up');
	// diagonal tie: neither axis dominates
	assert.equal(swipeDir(50, 50), null);
	// dominant axis below the threshold, even if the total travel is longer
	assert.equal(swipeDir(35, 30), null);
});

test('swipes map like the arrow keys: left = next photo, up = next burst', () => {
	assert.deepEqual(swipeAction('left'), { kind: 'item', delta: 1 });
	assert.deepEqual(swipeAction('right'), { kind: 'item', delta: -1 });
	assert.deepEqual(swipeAction('up'), { kind: 'burst', delta: 1 });
	assert.deepEqual(swipeAction('down'), { kind: 'burst', delta: -1 });
	assert.equal(swipeAction(null), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmOverrideOff, overrideOps } from './view-ops';

const doc = (slot: { hike?: unknown; post?: unknown }) => ({ fields: { 'map.origin': slot } });

test('overrideOps on copies the hike value into the post, off removes the post key; on without a hike value does nothing', () => {
	assert.deepEqual(overrideOps('map.origin', doc({ hike: { lat: 1, lon: 2 } }), true), { field: 'map.origin', scope: 'post', value: { lat: 1, lon: 2 } });
	assert.deepEqual(overrideOps('map.origin', doc({ hike: 1, post: 2 }), false), { field: 'map.origin', scope: 'post', value: null });
	assert.equal(overrideOps('map.origin', doc({}), true), null);
});

test('confirmOverrideOff asks only when the post value differs from the hike value', () => {
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: { lat: 1, lon: 2 }, post: { lat: 1, lon: 2 } })), false);
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: { lat: 1, lon: 2 }, post: { lat: 3, lon: 2 } })), true);
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: 1 })), false);
});

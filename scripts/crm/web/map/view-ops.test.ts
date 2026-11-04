import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmOverrideOff, overrideOps, parseLatLon, parseSize } from './view-ops';

const doc = (slot: { hike?: unknown; post?: unknown }) => ({ fields: { 'map.origin': slot } });

test('overrideOps on copies the current hike value into the post', () => {
	assert.deepEqual(overrideOps('map.origin', doc({ hike: { lat: 1, lon: 2 } }), true), { field: 'map.origin', scope: 'post', value: { lat: 1, lon: 2 } });
});

test('overrideOps off removes the post key; on without a hike value does nothing', () => {
	assert.deepEqual(overrideOps('map.origin', doc({ hike: 1, post: 2 }), false), { field: 'map.origin', scope: 'post', value: null });
	assert.equal(overrideOps('map.origin', doc({}), true), null);
});

test('confirmOverrideOff asks only when the post value differs from the hike value', () => {
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: { lat: 1, lon: 2 }, post: { lat: 1, lon: 2 } })), false);
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: { lat: 1, lon: 2 }, post: { lat: 3, lon: 2 } })), true);
	assert.equal(confirmOverrideOff('map.origin', doc({ hike: 1 })), false);
});

test('parseLatLon accepts pasted pairs and rejects nonsense', () => {
	assert.deepEqual(parseLatLon('47.71877, 11.80515'), { lat: 47.71877, lon: 11.80515 });
	assert.deepEqual(parseLatLon(' 47.5 11.25 '), { lat: 47.5, lon: 11.25 });
	assert.deepEqual(parseLatLon('(47.123456789, 11.1)'), { lat: 47.123457, lon: 11.1 });
	assert.equal(parseLatLon('95, 11'), null);
	assert.equal(parseLatLon('47'), null);
	assert.equal(parseLatLon('a, b'), null);
});

test('parseSize takes a whole number, rounds to 16 px like the corner drag and clamps to 128-2048', () => {
	assert.equal(parseSize('512'), 512);
	assert.equal(parseSize('520'), 528);
	assert.equal(parseSize('100'), 128);
	assert.equal(parseSize('2049'), 2048);
	assert.equal(parseSize('512.5'), null);
	assert.equal(parseSize(''), null);
});

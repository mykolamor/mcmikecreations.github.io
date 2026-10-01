// Run with: node_modules/.bin/jiti src/lib/hikes/photo-stops.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotoStops, photoStopsFromRecord, photoStopText, takenClock, takenOffset, type TimedPoint } from './photo-stops';

// A straight route north along lon 11.0: 11 points 0.01° (~1.11 km) apart, climbing 100 m each.
const NORTH = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const KM_PER_STEP = 1.112;

// The same line walked out and back.
const OUT_BACK = [...NORTH, ...NORTH.slice(0, -1).reverse()];

// Recorded along NORTH, 10:00 UTC onwards, 10 min per step.
const T0 = Date.parse('2026-06-01T10:00:00Z');
const TRACK: TimedPoint[] = NORTH.map(([lon, lat], i) => ({ lat, lon, t: T0 + i * 600000 }));

test('taken helpers read the wall clock and offset off the string', () => {
	assert.equal(takenClock('2026-09-27T11:18:16+02:00'), '11:18');
	assert.equal(takenOffset('2026-09-27T11:18:16+02:00'), 120);
	assert.equal(takenOffset('2026-06-07T09:00:00+05:45'), 345);
});

test('projects a located photo onto the route with altitude and the photo time', () => {
	const stops = computePhotoStops(NORTH, 1, [{ mediaIndex: 3, lat: 47.025, lon: 11.0005, taken: '2026-06-01T12:15:00+02:00' }], []);
	const stop = stops.get(3)!;
	assert.ok(Math.abs(stop.km! - 2.5 * KM_PER_STEP) < 0.01);
	assert.ok(Math.abs(stop.ele! - 1250) < 1);
	assert.equal(stop.time, '12:15');
	assert.equal(stop.timeSource, 'photo');
	assert.equal(stop.lat, 47.025);
});

test('applies the chart distance stretch', () => {
	const stops = computePhotoStops(NORTH, 2, [{ mediaIndex: 0, lat: 47.01, lon: 11.0 }], []);
	assert.ok(Math.abs(stops.get(0)!.km! - 2 * KM_PER_STEP) < 0.01);
});

test('a photo far off the route keeps only its time, and is not linked to the map', () => {
	const stops = computePhotoStops(NORTH, 1, [{ mediaIndex: 0, lat: 47.05, lon: 11.01, taken: '2026-06-01T12:00:00+02:00' }], []);
	assert.deepEqual(stops.get(0), { time: '12:00', timeSource: 'photo' });
});

test('a photo with nothing to show gets no stop', () => {
	const stops = computePhotoStops(NORTH, 1, [{ mediaIndex: 0 }, { mediaIndex: 1, lat: 48, lon: 12 }], []);
	assert.equal(stops.size, 0);
});

test('a photo without GPS but with a time shows only the time', () => {
	const stop = computePhotoStops(NORTH, 1, [{ mediaIndex: 0, taken: '2026-06-01T09:41:00+02:00' }], []).get(0)!;
	assert.deepEqual(stop, { time: '09:41', timeSource: 'photo' });
	assert.equal(photoStopText(stop), '09:41');
});

test('without a photo time, a recorded track gives the time it passed the photo', () => {
	const stop = computePhotoStops(NORTH, 1, [{ mediaIndex: 0, lat: 47.03, lon: 11.0, taken: undefined }], TRACK).get(0)!;
	// 3 steps at 10 min from 10:00 UTC; the track offset falls back to Europe/Berlin (CEST).
	assert.equal(stop.time, '12:30');
	assert.equal(stop.timeSource, 'track');
});

test('the track time uses the offset of the post\'s photos', () => {
	const stops = computePhotoStops(NORTH, 1, [
		{ mediaIndex: 0, lat: 47.0, lon: 11.0, taken: '2026-06-01T15:45:00+05:45' },
		{ mediaIndex: 1, lat: 47.03, lon: 11.0 }
	], TRACK);
	assert.equal(stops.get(1)!.time, '16:15');
});

test('out-and-back: reading order picks the way back for a later photo', () => {
	const photos = [
		{ mediaIndex: 0, lat: 47.08, lon: 11.0 },
		{ mediaIndex: 1, lat: 47.1, lon: 11.0 },
		{ mediaIndex: 2, lat: 47.02, lon: 11.0 }
	];
	const stops = computePhotoStops(OUT_BACK, 1, photos, []);
	assert.ok(Math.abs(stops.get(0)!.km! - 8 * KM_PER_STEP) < 0.01);
	assert.ok(Math.abs(stops.get(2)!.km! - 18 * KM_PER_STEP) < 0.01);
});

test('out-and-back: the photo time picks the leg, even against reading order', () => {
	const back: TimedPoint[] = OUT_BACK.map(([lon, lat], i) => ({ lat, lon, t: T0 + i * 600000 }));
	const photos = [
		{ mediaIndex: 0, lat: 47.1, lon: 11.0 },
		// Shown later in the post, but taken on the way out (step 2 = 10:20 UTC).
		{ mediaIndex: 1, lat: 47.02, lon: 11.0, taken: '2026-06-01T12:20:00+02:00' }
	];
	const stops = computePhotoStops(OUT_BACK, 1, photos, back);
	assert.ok(Math.abs(stops.get(1)!.km! - 2 * KM_PER_STEP) < 0.01);
});

test('caption text', () => {
	assert.equal(photoStopText({ km: 13.44, ele: 2051.6, time: '03:00' }), 'km 13.4 · 2052 m · 03:00');
	assert.equal(photoStopText({ km: 0.04, ele: 812 }), 'km 0.0 · 812 m');
});

test('out-and-back: photo times order the legs when the post shows photos out of order', () => {
	const photos = [
		{ mediaIndex: 0, lat: 47.02, lon: 11.0, taken: '2026-06-01T16:00:00+02:00' },
		{ mediaIndex: 1, lat: 47.1, lon: 11.0, taken: '2026-06-01T14:00:00+02:00' },
		{ mediaIndex: 2, lat: 47.02, lon: 11.0, taken: '2026-06-01T12:00:00+02:00' }
	];
	const stops = computePhotoStops(OUT_BACK, 1, photos, []);
	assert.ok(Math.abs(stops.get(2)!.km! - 2 * KM_PER_STEP) < 0.01);
	assert.ok(Math.abs(stops.get(0)!.km! - 18 * KM_PER_STEP) < 0.01);
});

test('stops survive the round trip through the server load', () => {
	const stops = computePhotoStops(NORTH, 1, [{ mediaIndex: 4, lat: 47.01, lon: 11.0 }], []);
	const back = photoStopsFromRecord(JSON.parse(JSON.stringify(Object.fromEntries(stops))));
	assert.deepEqual(back, stops);
	assert.equal(photoStopsFromRecord(undefined).size, 0);
});

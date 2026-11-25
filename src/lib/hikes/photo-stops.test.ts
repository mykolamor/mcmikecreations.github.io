// Run with: node_modules/.bin/jiti src/lib/hikes/photo-stops.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotoStops, type TimedPoint } from './photo-stops';

// A straight route north along lon 11.0: 11 points 0.01° (~1.11 km) apart, climbing 100 m each.
const NORTH = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const KM_PER_STEP = 1.112;

// The same line walked out and back.
const OUT_BACK = [...NORTH, ...NORTH.slice(0, -1).reverse()];

// Recorded along NORTH, 10:00 UTC onwards, 10 min per step.
const T0 = Date.parse('2026-06-01T10:00:00Z');
const TRACK: TimedPoint[] = NORTH.map(([lon, lat], i) => ({ lat, lon, t: T0 + i * 600000 }));

test('projects a located photo onto the route with altitude, the photo time and the distance stretch', () => {
	const stop = computePhotoStops(NORTH, 1, [{ mediaIndex: 3, lat: 47.025, lon: 11.0005, taken: '2026-06-01T12:15:00+02:00' }], []).get(3)!;
	assert.ok(Math.abs(stop.km! - 2.5 * KM_PER_STEP) < 0.01);
	assert.ok(Math.abs(stop.ele! - 1250) < 1);
	assert.equal(stop.time, '12:15');
	assert.equal(stop.timeSource, 'photo');
	assert.equal(stop.lat, 47.025);
	assert.ok(Math.abs(computePhotoStops(NORTH, 2, [{ mediaIndex: 0, lat: 47.01, lon: 11.0 }], []).get(0)!.km! - 2 * KM_PER_STEP) < 0.01);
});

test('a photo off the route or without GPS keeps only its time, and one with nothing to show gets no stop', () => {
	const stops = computePhotoStops(NORTH, 1, [
		{ mediaIndex: 0, lat: 47.05, lon: 11.01, taken: '2026-06-01T12:00:00+02:00' },
		{ mediaIndex: 1, taken: '2026-06-01T09:41:00+02:00' },
		{ mediaIndex: 2 },
		{ mediaIndex: 3, lat: 48, lon: 12 }
	], []);
	assert.deepEqual(stops.get(0), { time: '12:00', timeSource: 'photo' });
	assert.deepEqual(stops.get(1), { time: '09:41', timeSource: 'photo' });
	assert.equal(stops.size, 2);
});

test('without a photo time, a recorded track gives the time it passed the photo, in the post\'s photos\' offset', () => {
	const stop = computePhotoStops(NORTH, 1, [{ mediaIndex: 0, lat: 47.03, lon: 11.0, taken: undefined }], TRACK).get(0)!;
	// 3 steps at 10 min from 10:00 UTC; the track offset falls back to Europe/Berlin (CEST).
	assert.equal(stop.time, '12:30');
	assert.equal(stop.timeSource, 'track');
	const nepal = computePhotoStops(NORTH, 1, [
		{ mediaIndex: 0, lat: 47.0, lon: 11.0, taken: '2026-06-01T15:45:00+05:45' },
		{ mediaIndex: 1, lat: 47.03, lon: 11.0 }
	], TRACK);
	assert.equal(nepal.get(1)!.time, '16:15');
});

test('out-and-back: reading order picks the leg, unless photo times say otherwise', () => {
	const km = (stops: Map<number, { km?: number }>, i: number) => stops.get(i)!.km! / KM_PER_STEP;
	const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
	// A later photo in the post is on the way back.
	const reading = computePhotoStops(OUT_BACK, 1, [{ mediaIndex: 0, lat: 47.08, lon: 11.0 }, { mediaIndex: 1, lat: 47.1, lon: 11.0 }, { mediaIndex: 2, lat: 47.02, lon: 11.0 }], []);
	near(km(reading, 0), 8);
	near(km(reading, 2), 18);
	// Shown later in the post, but taken on the way out (step 2 = 10:20 UTC on the track).
	const back: TimedPoint[] = OUT_BACK.map(([lon, lat], i) => ({ lat, lon, t: T0 + i * 600000 }));
	const tracked = computePhotoStops(OUT_BACK, 1, [{ mediaIndex: 0, lat: 47.1, lon: 11.0 }, { mediaIndex: 1, lat: 47.02, lon: 11.0, taken: '2026-06-01T12:20:00+02:00' }], back);
	near(km(tracked, 1), 2);
	// Without a track, photo times order the legs when the post shows photos out of order.
	const timed = computePhotoStops(OUT_BACK, 1, [
		{ mediaIndex: 0, lat: 47.02, lon: 11.0, taken: '2026-06-01T16:00:00+02:00' },
		{ mediaIndex: 1, lat: 47.1, lon: 11.0, taken: '2026-06-01T14:00:00+02:00' },
		{ mediaIndex: 2, lat: 47.02, lon: 11.0, taken: '2026-06-01T12:00:00+02:00' }
	], []);
	near(km(timed, 2), 2);
	near(km(timed, 0), 18);
});

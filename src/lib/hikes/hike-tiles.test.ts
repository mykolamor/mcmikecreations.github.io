// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/hike-tiles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hikeTiles, showElapsed, TILE_ORDER, type HikeTileInput } from './hike-tiles';
import { getTime } from './build-statistics';
import type { HikeAuthoredFacts } from './facts-schema';

const authored: HikeAuthoredFacts = {
	difficulty: { sac: 'T3', sacSource: 'computed', exposure: { level: 'moderate' }, fitness: 3 },
	season: { best: [6, 7, 8] },
	access: { carFree: 'yes' }
} as HikeAuthoredFacts;

function full(): HikeTileInput {
	return {
		properties: { duration: 352, distance: 22305, ascent: 1041, descent: 1039 },
		durationSource: 'gpx',
		facts: {
			highPoint: 2052,
			lowPoint: 900,
			routeType: 'loop',
			typicalDuration: 437,
			elapsed: { minutes: 420, source: 'gpx' }
		},
		authoredFacts: authored
	};
}

test('tiles follow the agreed order', () => {
	const keys = hikeTiles(full(), 'en').map((t) => t.key);
	assert.deepEqual(keys, [
		'distance', 'typical', 'ascent', 'difficulty', 'season',
		'highPoint', 'lowPoint', 'descent', 'routeType', 'carFree', 'movingTime', 'elapsed', 'exposure', 'fitness'
	]);
	assert.deepEqual(keys, [...TILE_ORDER]);
});

test('values and marks match the old title card', () => {
	const byKey = (input: HikeTileInput) => Object.fromEntries(hikeTiles(input, 'en').map((t) => [t.key, t]));
	const tiles = byKey(full());
	assert.equal(tiles.movingTime.label, 'Moving time*');
	assert.equal(tiles.movingTime.value, getTime(352));
	assert.equal(byKey({ ...full(), durationSource: 'planner' }).movingTime.label, 'Planner estimate*');
	assert.equal(tiles.elapsed.label, 'Elapsed**');
	assert.equal(tiles.elapsed.value, getTime(420));
	const photos = full();
	photos.facts.elapsed = { minutes: 420, source: 'photos' };
	assert.equal(byKey(photos).elapsed.value, '≥ ' + getTime(420));
	assert.equal(tiles.typical.label, 'Typical time***');
	assert.equal(tiles.typical.value, '≈ ' + getTime(435));
	assert.equal(tiles.highPoint.value, '2052 m');
	assert.equal(tiles.routeType.icon, 'loop');
	assert.equal(tiles.distance.icon, 'distance');
	assert.equal(tiles.carFree.href, '#facts-access');
	assert.ok(tiles.difficulty.hint);
	const manual = full();
	manual.authoredFacts = { ...authored, difficulty: { ...authored.difficulty, sacSource: 'manual' } } as HikeAuthoredFacts;
	assert.equal(byKey(manual).difficulty.hint, undefined);
});

test('a post without a sidecar keeps the computed order', () => {
	const keys = hikeTiles({ ...full(), authoredFacts: null }, 'en').map((t) => t.key);
	assert.deepEqual(keys, ['distance', 'typical', 'ascent', 'highPoint', 'lowPoint', 'descent', 'routeType', 'movingTime', 'elapsed']);
});

test('elapsed within a minute of moving time is left out', () => {
	const input = full();
	input.facts.elapsed = { minutes: 353, source: 'gpx' };
	assert.equal(showElapsed(input), false);
	assert.ok(!hikeTiles(input, 'en').some((t) => t.key === 'elapsed'));
});

test('missing computed facts drop their tiles', () => {
	const input = full();
	input.facts = { highPoint: null, lowPoint: null, routeType: null, typicalDuration: null, elapsed: null };
	const keys = hikeTiles(input, 'en').map((t) => t.key);
	for (const key of ['typical', 'highPoint', 'lowPoint', 'routeType', 'elapsed']) assert.ok(!keys.includes(key as never), key);
});

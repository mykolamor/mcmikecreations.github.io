// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/hike-tiles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hikeTiles, showElapsed, type HikeTileInput } from './hike-tiles';
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

const keys = (input: HikeTileInput) => hikeTiles(input, 'en').map((t) => t.key);

test('tiles show what the post has, in order', () => {
	assert.deepEqual(keys(full()), [
		'distance', 'typical', 'ascent', 'difficulty', 'season',
		'highPoint', 'lowPoint', 'descent', 'routeType', 'carFree', 'movingTime', 'elapsed', 'exposure', 'fitness'
	]);
	// No sidecar: the computed tiles keep their order.
	assert.deepEqual(keys({ ...full(), authoredFacts: null }), ['distance', 'typical', 'ascent', 'highPoint', 'lowPoint', 'descent', 'routeType', 'movingTime', 'elapsed']);
	// Missing computed facts drop their tiles.
	const bare = full();
	bare.facts = { highPoint: null, lowPoint: null, routeType: null, typicalDuration: null, elapsed: null };
	for (const key of ['typical', 'highPoint', 'lowPoint', 'routeType', 'elapsed']) assert.ok(!keys(bare).includes(key as never), key);
	// An elapsed time from photos is a lower bound.
	const photos = full();
	photos.facts.elapsed = { minutes: 420, source: 'photos' };
	assert.equal(hikeTiles(photos, 'en').find((t) => t.key === 'elapsed')!.value, '≥ ' + getTime(420));
});

test('elapsed within a minute of moving time is left out', () => {
	const input = full();
	input.facts.elapsed = { minutes: 353, source: 'gpx' };
	assert.equal(showElapsed(input), false);
	assert.ok(!keys(input).includes('elapsed'));
});

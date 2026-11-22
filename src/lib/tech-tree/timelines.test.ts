// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/tech-tree/timelines.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMELINES, validateTimelines, type TimelineDef } from './timelines';
import { missingKeys, t } from '$lib/i18n/strings';

test('the configured timelines are valid', () => {
	assert.doesNotThrow(() => validateTimelines(TIMELINES));
});

test('invalid timeline configs throw', () => {
	const era = (key: string, from: number, to: number | null) => ({ key, from, to });
	const bad: TimelineDef[][] = [
		[{ key: 'x', eras: [era('a', 1970, null)] }, { key: 'x', eras: [era('a', 1970, null)] }],
		[{ key: 'x', eras: [] }],
		[{ key: 'x', eras: [era('a', 1970, 1989), era('b', 1991, null)] }],
		[{ key: 'x', eras: [era('a', 1970, 1990), era('b', 1990, null)] }],
		[{ key: 'x', eras: [era('a', 1980, 1970)] }],
		[{ key: 'x', eras: [era('a', 1970, null), era('b', 1990, null)] }]
	];
	for (const defs of bad) assert.throws(() => validateTimelines(defs), /Tech tree timeline/, JSON.stringify(defs));
});

test('every timeline and era has an English label', () => {
	for (const tl of TIMELINES) {
		assert.doesNotThrow(() => t('en', `techTree.timelines.${tl.key}.name`));
		for (const era of tl.eras) assert.doesNotThrow(() => t('en', `techTree.timelines.${tl.key}.eras.${era.key}`));
	}
});

test('German and Ukrainian have every techTree string', () => {
	assert.deepEqual(missingKeys('de').filter((k) => k.startsWith('techTree.')), []);
	assert.deepEqual(missingKeys('uk').filter((k) => k.startsWith('techTree.')), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gapBadges, tabHasGap, type Gaps } from './translation-gaps';

test('one badge per language with something missing, naming the parts in a fixed order', () => {
	assert.deepEqual(gapBadges({ de: ['facts', 'text'], uk: ['details'] }), ['DE: Facts, Text', 'UK: Details']);
	assert.deepEqual(gapBadges({}), []);
});

test('each part marks its own tab, for the given language only', () => {
	const g: Gaps = { de: ['facts', 'text', 'details'], uk: ['details'] };
	assert.equal(tabHasGap(g, 'de', 'facts'), true);
	assert.equal(tabHasGap(g, 'de', 'write'), true);
	assert.equal(tabHasGap(g, 'de', 'details'), true);
	assert.equal(tabHasGap(g, 'de', 'map'), false);
	assert.equal(tabHasGap(g, 'uk', 'facts'), false);
	assert.equal(tabHasGap(g, 'fr', 'details'), false);
	assert.equal(tabHasGap(g, null, 'details'), false);
});

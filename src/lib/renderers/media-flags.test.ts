import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaFlags } from './media-flags';

test('presentation is a recognised flag', () => {
	assert.equal(parseMediaFlags('presentation').flags.has('presentation'), true);
});

test('presentation flag is stripped from a title that carries one', () => {
	assert.equal(parseMediaFlags('presentation, Some title').title, 'Some title');
});

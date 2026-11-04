import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSlug, assertSafeDate, repoPaths } from './paths';
import { ApiError } from './api';

const is400 = (e: unknown) => e instanceof ApiError && e.status === 400;

test('assertSafeSlug rejects unsafe slugs', () => {
	for (const bad of ['../x', 'Upper', '', '_x', 'a/b', 'a-b']) {
		assert.throws(() => assertSafeSlug(bad), is400, bad);
	}
});

test('assertSafeSlug accepts real slugs', () => {
	assertSafeSlug('hoehengluecksteig');
	assertSafeSlug('annapurna_bc_1');
});

test('assertSafeDate checks the calendar', () => {
	assertSafeDate('2026-02-28');
	assertSafeDate('2024-02-29');
	for (const bad of ['2026-02-30', '2026-2-3', '', 'x', '2026-13-01']) {
		assert.throws(() => assertSafeDate(bad), is400, bad);
	}
});

test('repoPaths are absolute under root', () => {
	const p = repoPaths('/r');
	assert.equal(p.markdown, '/r/static/_projects/data-viz/hikes/markdown');
	assert.equal(p.osmStore, '/r/static/_projects/data-viz/hikes/osm.json');
	assert.equal(p.crmData, '/r/scripts/crm/data');
	assert.equal(p.hikesJson, '/r/src/lib/data/hikes.json');
});

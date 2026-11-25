import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSlug, assertSafeDate } from './paths';
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

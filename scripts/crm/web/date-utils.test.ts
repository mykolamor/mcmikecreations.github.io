import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, localDate } from './date-utils';

test('isValidDate rejects impossible days; localDate is the local calendar day, not UTC', () => {
	assert.ok(isValidDate('2024-02-29'));
	assert.ok(!isValidDate('2023-02-29'));
	assert.ok(!isValidDate('2024-1-1'));
	assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

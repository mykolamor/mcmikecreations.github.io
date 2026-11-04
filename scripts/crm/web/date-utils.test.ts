import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, localDate, maskDate, monthGrid, shiftMonth } from './date-utils';

test('maskDate inserts dashes and drops junk', () => {
	assert.equal(maskDate('20240'), '2024-0');
	assert.equal(maskDate('2024-0229x'), '2024-02-29');
	assert.equal(maskDate('202401011234'), '2024-01-01');
});
test('isValidDate rejects impossible days', () => {
	assert.ok(isValidDate('2024-02-29'));
	assert.ok(!isValidDate('2023-02-29'));
	assert.ok(!isValidDate('2024-1-1'));
});
test('monthGrid is Monday-first and padded to full weeks', () => {
	const g = monthGrid(2024, 2); // 1 Feb 2024 is a Thursday
	assert.deepEqual(g[0].slice(0, 4), [null, null, null, '2024-02-01']);
	assert.ok(g.every((w) => w.length === 7));
	assert.equal(g.flat().filter(Boolean).length, 29);
});
test('shiftMonth wraps years', () => {
	assert.deepEqual(shiftMonth(2024, 1, -1), { year: 2023, month: 12 });
	assert.deepEqual(shiftMonth(2024, 12, 1), { year: 2025, month: 1 });
});
test('localDate is the local calendar day', () => {
	assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

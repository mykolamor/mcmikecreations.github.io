import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, RECORDS, entryKey, identity, specAt, type Spec } from './facts-spec';

test('specAt finds nested fields', () => {
	assert.deepEqual(specAt(['access', 'transport', 0, 'from']), { t: 'text' });
	assert.deepEqual(specAt(['legs', 2, 'onProfile']), { t: 'bool' });
	assert.equal(specAt(['nope']), undefined);
	assert.equal(specAt([]), FACTS);
});

test('entryKey separates table and profile entries', () => {
	const legs = FACTS.f.legs as Extract<Spec, { t: 'list' }>;
	assert.notEqual(entryKey(legs, { to: 'X' }), entryKey(legs, { to: 'X', inTable: false, onProfile: true }));
});

test('identity reads through a record', () => {
	const id = [['mode', 'from', 'to']];
	const record = { mode: 'train', from: 'A', to: 'B' };
	assert.equal(identity({ use: 'r' }, id, record), identity(record, id));
});

test('specAt walks from another root, such as a record', () => {
	assert.deepEqual(specAt(['name'], RECORDS.tickets), { t: 'text' });
	assert.deepEqual(specAt(['price', 0, 'amount'], RECORDS.tickets), { t: 'num', min: 0 });
	assert.equal(specAt(['at'], RECORDS.stops), undefined, "a stop's record has no `at`");
	assert.equal(specAt([], RECORDS.lifts), RECORDS.lifts);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, RECORDS, entryKey, identity, specAt, type Spec } from './facts-spec';

test('specAt walks nested fields from the facts or a record; entries key by kind and through records', () => {
	assert.deepEqual(specAt(['access', 'transport', 0, 'from']), { t: 'text' });
	assert.equal(specAt(['nope']), undefined);
	assert.deepEqual(specAt(['price', 0, 'amount'], RECORDS.tickets), { t: 'num', min: 0 });
	assert.equal(specAt(['at'], RECORDS.stops), undefined, "a stop's record has no `at`");
	// A table leg and a profile entry to the same place are different entries.
	const legs = FACTS.f.legs as Extract<Spec, { t: 'list' }>;
	assert.notEqual(entryKey(legs, { to: 'X' }), entryKey(legs, { to: 'X', inTable: false, onProfile: true }));
	// An entry that uses a record is identified by the record's fields.
	const id = [['mode', 'from', 'to']];
	const record = { mode: 'train', from: 'A', to: 'B' };
	assert.equal(identity({ use: 'r' }, id, record), identity(record, id));
});

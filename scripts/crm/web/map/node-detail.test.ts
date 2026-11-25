import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPatch, mergeRefreshed, rowsOf } from './node-detail';

test('localPatch: empty value -> null, blank keys dropped, visited added, unchanged -> null (no PATCH)', () => {
	const orig = { name: 'X', visited: 'yes' };
	assert.equal(localPatch(orig, [{ key: 'name', value: 'X' }], 'yes'), null);
	assert.deepEqual(localPatch(orig, [{ key: 'name', value: 'X' }, { key: 'ele', value: '' }, { key: '  ', value: 'z' }], 'yes'), { name: 'X', ele: null, visited: 'yes' });
	assert.deepEqual(localPatch(orig, [{ key: 'name', value: 'Y' }], ''), { name: 'Y' });
	assert.deepEqual(localPatch(undefined, [], 'no'), { visited: 'no' });
	assert.deepEqual(localPatch({ name: 'X' }, [], ''), {});
	assert.equal(localPatch(undefined, [], ''), null);
});

test('mergeRefreshed: unsaved edits win by key, keys added elsewhere appear and survive the save', () => {
	const loaded = { a: '1' };
	const edited = rowsOf(loaded);
	edited.rows[0].value = '2';
	const merged = mergeRefreshed(loaded, edited.rows, edited.visited, { a: '1', b: '3' });
	assert.deepEqual(merged.rows, [{ key: 'a', value: '2' }, { key: 'b', value: '3' }]);
	assert.deepEqual(localPatch({ a: '1', b: '3' }, merged.rows, merged.visited), { a: '2', b: '3' });
});

test('mergeRefreshed: untouched keys take the server value, user removals and visited edits hold, blank rows stay', () => {
	const loaded = { a: '1', c: 'x', visited: 'no' };
	const cur = rowsOf(loaded);
	cur.rows = cur.rows.filter((r) => r.key !== 'c'); // user removed c
	cur.rows.push({ key: '', value: '' });
	const m = mergeRefreshed(loaded, cur.rows, 'yes', { a: '9', c: 'x', visited: 'no' });
	assert.deepEqual(m.rows, [{ key: 'a', value: '9' }, { key: '', value: '' }]);
	assert.equal(m.visited, 'yes');
});

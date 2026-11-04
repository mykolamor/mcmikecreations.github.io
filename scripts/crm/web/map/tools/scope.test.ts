import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentValue, scopeOf, setField, type EditSession } from './scope';
import type { FieldOp } from '../../../shared/ops';

function session(fields: Record<string, unknown>): EditSession & { ops: FieldOp[] } {
	const ops: FieldOp[] = [];
	return { doc: { version: 'v1', fields }, queue: { pending: () => [...ops] }, edit: (op) => void ops.push(op), ops };
}

test('scope is post only when the post carries the field', () => {
	assert.equal(scopeOf(session({ 'map.origin': { hike: { lat: 1, lon: 2 } } }), 'map.origin'), 'hike');
	assert.equal(scopeOf(session({ 'map.origin': { hike: 1, post: 2 } }), 'map.origin'), 'post');
	assert.equal(scopeOf(session({}), 'map.origin'), 'hike');
});

test('currentValue sees an edit sent but not yet in the doc', () => {
	const s = { doc: { version: 'v1', fields: { 'map.checkpoints': { hike: [[1, 2]] } } }, queue: { pending: () => [] }, edit() {} } as EditSession;
	assert.deepEqual(currentValue(s, 'map.checkpoints', 'hike'), [[1, 2]]);
	setField(s, 'map.checkpoints', [[1, 2], [3, 4]], 'hike');
	assert.deepEqual(currentValue(s, 'map.checkpoints', 'hike'), [[1, 2], [3, 4]]);
	s.doc = { version: 'v2', fields: { 'map.checkpoints': { hike: [[1, 2], [3, 4]] } } };
	assert.deepEqual(currentValue(s, 'map.checkpoints', 'hike'), [[1, 2], [3, 4]]);
});

test('three rapid taps with responses interleaved keep all three values', () => {
	const f = 'map.checkpoints';
	const s = { doc: { version: 'v1', fields: {} as Record<string, unknown> }, queue: { pending: () => [] }, edit() {} } as EditSession;
	const tap = (pt: [number, number]) => setField(s, f, [...(currentValue<[number, number][]>(s, f, 'hike') ?? []), pt], 'hike');
	tap([1, 1]);
	tap([2, 2]); // response 1 not back yet
	s.doc = { version: 'v2', fields: { [f]: { hike: [[1, 1]] } } }; // response 1 arrives, carries only the first
	tap([3, 3]);
	s.doc = { version: 'v3', fields: { [f]: { hike: [[1, 1], [2, 2], [3, 3]] } } };
	assert.deepEqual(currentValue(s, f, 'hike'), [[1, 1], [2, 2], [3, 3]]);
});

test('a failed save drops the in-flight value', () => {
	const s = { doc: { version: 'v1', fields: {} }, queue: { pending: () => [], status: 'saving' }, edit() {} } as EditSession;
	setField(s, 'map.origin', { lat: 1, lon: 2 }, 'hike');
	assert.deepEqual(currentValue(s, 'map.origin', 'hike'), { lat: 1, lon: 2 });
	s.queue.status = 'error';
	assert.equal(currentValue(s, 'map.origin', 'hike'), undefined);
});

test('an in-flight removal (null) is cleared once the doc has no value', () => {
	const s = { doc: { version: 'v1', fields: { 'map.origin': { hike: 1, post: 2 } } as Record<string, unknown> }, queue: { pending: () => [] }, edit() {} } as EditSession;
	setField(s, 'map.origin', null, 'post');
	assert.equal(currentValue(s, 'map.origin', 'post'), null);
	s.doc = { version: 'v2', fields: { 'map.origin': { hike: 1 } } };
	assert.equal(currentValue(s, 'map.origin', 'post'), undefined);
});

test('an in-flight post value of one session does not leak into another hike', () => {
	const a = { doc: { version: 'v1', fields: {} }, queue: { pending: () => [], status: 'saving' }, edit() {} } as EditSession;
	const b = { doc: { version: 'v1', fields: {} }, queue: { pending: () => [], status: 'saved' }, edit() {} } as EditSession;
	setField(a, 'map.origin', { lat: 1, lon: 2 }, 'post');
	assert.equal(scopeOf(a, 'map.origin'), 'post');
	assert.equal(scopeOf(b, 'map.origin'), 'hike');
	assert.equal(currentValue(b, 'map.origin', 'post'), undefined);
});

for (const scope of ['hike', 'post'] as const) {
	test(`removing the last checkpoint (${scope}) clears the in-flight value once the doc slot is gone`, () => {
		const f = 'map.checkpoints';
		const ops: any[] = [];
		const s = { doc: { version: 'v1', fields: { [f]: { hike: [[1, 2]], post: [[1, 2]] } } as Record<string, unknown> }, queue: { pending: () => [] }, edit: (o: any) => void ops.push(o) } as EditSession;
		setField(s, f, [], scope);
		assert.equal(ops[0].value, null); // an empty list is sent as a removal
		assert.equal(currentValue(s, f, scope), null);
		s.doc = { version: 'v2', fields: { [f]: scope === 'post' ? { hike: [[1, 2]] } : {} } };
		assert.equal(currentValue(s, f, scope), undefined);
		if (scope === 'post') assert.equal(scopeOf(s, f), 'hike');
		// later on-disk changes are visible again
		s.doc = { version: 'v3', fields: { [f]: { hike: [[5, 6]], post: [[7, 8]] } } };
		assert.deepEqual(currentValue(s, f, scope), scope === 'post' ? [[7, 8]] : [[5, 6]]);
	});
}

test('an unsent empty-list edit reads as no value', () => {
	const s = { doc: { version: 'v1', fields: { 'map.checkpoints': { hike: [[1, 2]] } } }, queue: { pending: () => [{ field: 'map.checkpoints', value: [] }] }, edit() {} } as EditSession;
	assert.equal(currentValue(s, 'map.checkpoints', 'hike'), undefined);
});

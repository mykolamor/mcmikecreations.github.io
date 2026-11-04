import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, isContainer, isEmpty, isObject, removeAt, setAt } from './tree';

test('at reads a path through maps and lists', () => {
	const v = { a: [{ b: 1 }, null] };
	assert.equal(at(v, ['a', 0, 'b']), 1);
	assert.equal(at(v, ['a', 1, 'b']), undefined, 'through a null');
	assert.equal(at(v, ['x', 'y']), undefined);
	assert.equal(at(v, []), v);
});

test('isObject, isContainer and isEmpty', () => {
	assert.deepEqual([isObject({}), isObject([]), isObject(null), isObject('s')], [true, false, false, false]);
	assert.deepEqual([isContainer({}), isContainer([]), isContainer(null), isContainer(0)], [true, true, false, false]);
	assert.deepEqual([isEmpty({}), isEmpty([]), isEmpty({ a: 1 }), isEmpty([0]), isEmpty(null), isEmpty('')], [true, true, false, false, false, false]);
});

test('setAt makes the containers on the way, a list for a number step, and copies the value', () => {
	const root: Record<string, unknown> = { a: { keep: 1 } };
	const value = { n: 1 };
	setAt(root, ['a', 'list', 0, 'x'], value);
	assert.deepEqual(root, { a: { keep: 1, list: [{ x: { n: 1 } }] } });
	value.n = 2;
	assert.deepEqual(at(root, ['a', 'list', 0, 'x']), { n: 1 });
});

test('removeAt removes the value and the containers it leaves empty, never above `keep` steps', () => {
	const root = () => ({ f: { a: { list: [{ x: 1 }] }, b: 2 } });
	const r = root();
	removeAt(r, ['f', 'a', 'list', 0]);
	assert.deepEqual(r, { f: { b: 2 } });
	const all = { f: { a: [1] } };
	removeAt(all, ['f', 'a', 0]);
	assert.deepEqual(all, {}, 'up to the root');
	const kept = { r: { a: [1] } };
	removeAt(kept, ['r', 'a', 0], 1);
	assert.deepEqual(kept, { r: {} }, 'the first step stays');
	const list = { l: [1, 2, 3] };
	removeAt(list, ['l', 1]);
	assert.deepEqual(list, { l: [1, 3] }, 'a list entry is spliced out');
});

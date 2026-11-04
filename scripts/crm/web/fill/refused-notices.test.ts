import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeKey, readRefused, writeRefused } from './refused-notices';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const ONE = [{ id: 'block:5', label: 'Block 6: photo', reason: 'DeepL broke a photo or video line' }];

test('refused texts are read back until they are replaced by an empty list', () => {
	const s = memory();
	writeRefused(s, 'k', ONE);
	assert.deepEqual(readRefused(s, 'k'), ONE);
	writeRefused(s, 'k', []);
	assert.deepEqual(readRefused(s, 'k'), []);
	assert.equal(s.map.size, 0);
});

test('each surface of each doc and language has its own notice', () => {
	const keys = [noticeKey('?slug=a', 'de', 'write'), noticeKey('?slug=b', 'de', 'write'), noticeKey('?slug=a', 'uk', 'write'), noticeKey('?slug=a', 'de', 'facts')];
	assert.equal(new Set(keys).size, 4);
});

test('an unusable storage or a damaged notice reads as none and never throws', () => {
	const broken = {
		getItem() {
			throw new Error('blocked');
		},
		setItem() {
			throw new Error('blocked');
		},
		removeItem() {
			throw new Error('blocked');
		}
	};
	assert.deepEqual(readRefused(broken, 'k'), []);
	assert.doesNotThrow(() => writeRefused(broken, 'k', ONE));
	const s = memory();
	s.setItem('k', 'not json');
	assert.deepEqual(readRefused(s, 'k'), []);
	s.setItem('k', '{"a":1}');
	assert.deepEqual(readRefused(s, 'k'), []);
});

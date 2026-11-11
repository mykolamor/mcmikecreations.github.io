import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPosition, normalize } from './order';
import { loadPosition, savePosition, storageKey, type PositionStorage } from './saved-position';

const p = normalize({ name: 'demo', slides: [{ name: 'intro' }, { states: 2 }, { name: 'bars', states: [{ name: 'grow' }, {}] }] });

function memory(): PositionStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test('storageKey is per page and presentation', () => {
	assert.equal(storageKey(p, '/blog/a'), 'presentation:/blog/a:demo');
	assert.notEqual(storageKey(p, '/blog/a'), storageKey(p, '/blog/b'));
});

test('saves names where there are names, indices otherwise, and round-trips', () => {
	const s = memory();
	for (const [pos, stored] of [
		[{ slide: 0, state: 0 }, { slide: 'intro', state: 0 }],
		[{ slide: 1, state: 1 }, { slide: 1, state: 1 }],
		[{ slide: 2, state: 0 }, { slide: 'bars', state: 'grow' }],
		[{ slide: 2, state: 1 }, { slide: 'bars', state: 1 }]
	] as const) {
		savePosition(s, 'k', p, pos);
		assert.deepEqual(JSON.parse(s.data.get('k')!), stored);
		assert.deepEqual(initialPosition(p, [loadPosition(s, 'k')]), pos);
	}
});

test('loadPosition rejects missing and malformed values', () => {
	const s = memory();
	assert.equal(loadPosition(s, 'k'), null);
	for (const bad of ['nope', '{}', '{"slide":1}', '{"slide":1.5,"state":0}', 'null', '[1,2]']) {
		s.data.set('k', bad);
		assert.equal(loadPosition(s, 'k'), null, bad);
	}
});

test('a stale saved position falls through to the next source', () => {
	const s = memory();
	s.data.set('k', JSON.stringify({ slide: 'gone', state: 0 }));
	assert.deepEqual(initialPosition(p, [null, loadPosition(s, 'k'), { slide: 'bars' }]), { slide: 2, state: 0 });
});

test('storage that throws or is missing is ignored', () => {
	const broken: PositionStorage = {
		getItem: () => { throw new Error('blocked'); },
		setItem: () => { throw new Error('quota'); }
	};
	assert.doesNotThrow(() => savePosition(broken, 'k', p, { slide: 0, state: 0 }));
	assert.equal(loadPosition(broken, 'k'), null);
	assert.doesNotThrow(() => savePosition(null, 'k', p, { slide: 0, state: 0 }));
	assert.equal(loadPosition(null, 'k'), null);
});

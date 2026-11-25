import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldOp } from '../../shared/ops';
import { REMOVE, editOp, localFacts } from './facts-state';

const doc = (hike: unknown, post: unknown = null, version = 'v1') => ({ version, facts: { hike, post } });

test('localFacts applies queued edits in order', () => {
	const d = doc({ summary: 'Old', season: { best: [7] } });
	const pending: FieldOp[] = [
		editOp('hike', ['summary'], { en: 'New', de: 'Neu' }),
		editOp('hike', ['season', 'best'], [6, 7]),
		editOp('hike', ['water', 0, 'at'], 'Spring hut'),
		editOp('hike', ['summary'], { en: 'Newer', de: '' }),
		editOp('post', ['checked'], '2026-10-31'),
		{ field: 'post.title', value: 'T' }
	];
	assert.deepEqual(localFacts(d, pending, 'hike'), { summary: { en: 'Newer' }, season: { best: [6, 7] }, water: [{ at: 'Spring hut' }] });
	assert.deepEqual(localFacts(d, pending, 'post'), { checked: '2026-10-31' });
	assert.deepEqual(d.facts.hike, { summary: 'Old', season: { best: [7] } }, 'the doc is untouched');
});

test('localFacts drops an entry removed by a queued op, and keeps a null text', () => {
	const d = doc({ water: [{ at: 'A' }, { at: 'B' }, { at: 'C' }], season: { best: [7] } });
	const pending: FieldOp[] = [editOp('hike', ['water', 1], REMOVE), editOp('hike', ['water', 1, 'note'], 'only C')];
	assert.deepEqual(localFacts(d, pending, 'hike'), { water: [{ at: 'A' }, { at: 'C', note: { en: 'only C' } }], season: { best: [7] } });
	// The last entry and the last key go with their containers.
	assert.equal(localFacts(doc({ water: [{ at: 'A' }] }), [editOp('hike', ['water', 0], REMOVE)], 'hike'), undefined);
	assert.deepEqual(localFacts(doc({ season: { best: [7] }, summary: 'S' }), [editOp('hike', ['season', 'best'], REMOVE)], 'hike'), { summary: 'S' });
	// A null text is kept, not dropped: the visit removes the hike's text.
	const d2 = doc({ summary: 'Hike' }, { summary: 'Visit', checked: '2026-10-31' });
	assert.deepEqual(localFacts(d2, [editOp('post', ['summary'], null)], 'post'), { summary: null, checked: '2026-10-31' });
});

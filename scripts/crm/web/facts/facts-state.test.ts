import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldOp } from '../../shared/ops';
import { REMOVE, editOp, localFacts, moveOp, shownOps, statedTexts } from './facts-state';

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

test('localFacts drops an entry removed by a queued op', () => {
	const d = doc({ water: [{ at: 'A' }, { at: 'B' }, { at: 'C' }], season: { best: [7] } });
	const pending: FieldOp[] = [editOp('hike', ['water', 1], REMOVE), editOp('hike', ['water', 1, 'note'], 'only C')];
	assert.deepEqual(localFacts(d, pending, 'hike'), { water: [{ at: 'A' }, { at: 'C', note: { en: 'only C' } }], season: { best: [7] } });
	// The last entry and the last key go with their containers.
	assert.equal(localFacts(doc({ water: [{ at: 'A' }] }), [editOp('hike', ['water', 0], REMOVE)], 'hike'), undefined);
	assert.deepEqual(localFacts(doc({ season: { best: [7] }, summary: 'S' }), [editOp('hike', ['season', 'best'], REMOVE)], 'hike'), { summary: 'S' });
});

test('editOp normalises texts in a whole value and leaves a text field edit as typed', () => {
	assert.deepEqual(editOp('hike', ['water', 0], { at: 'A', note: { en: 'N', de: '' } }), { kind: 'facts', scope: 'hike', path: ['water', 0], value: { at: 'A', note: { en: 'N' } } });
	assert.deepEqual(editOp('hike', ['summary'], { en: 'S', de: '' }), { kind: 'facts', scope: 'hike', path: ['summary'], value: { en: 'S', de: '' } });
	assert.deepEqual(editOp('post', ['water', 2], REMOVE), { kind: 'facts', scope: 'post', path: ['water', 2], remove: true });
});

test('moveOp sets the list in its new order, entries as they are', () => {
	const list = [{ at: 'A', note: { en: 'x' } }, { at: 'B' }];
	assert.deepEqual(moveOp('hike', ['water'], list, 1, 0), { kind: 'facts', scope: 'hike', path: ['water'], value: [{ at: 'B' }, { at: 'A', note: { en: 'x' } }] });
});

test('statedTexts gathers the doc value and every op value at the path', () => {
	const d = doc({ summary: { en: 'A', de: 'Ä' }, water: [{ at: 'X', note: 'n' }] });
	const ops: FieldOp[] = [
		editOp('hike', ['summary'], { en: 'A', de: '' }),
		editOp('hike', ['summary'], { en: 'B', fr: 'Bé' }),
		editOp('post', ['summary'], { it: 'x' }),
		editOp('hike', ['checked'], '2026-11-01')
	];
	assert.deepEqual(statedTexts(d, ops, 'hike', ['summary']), [{ en: 'A', de: 'Ä' }, { en: 'A', de: '' }, { en: 'B', fr: 'Bé' }]);
	// a whole entry set holds the text too
	const entry = editOp('hike', ['water', 0], { at: 'X', note: { en: 'n', de: 'N' } });
	assert.deepEqual(statedTexts(d, [entry], 'hike', ['water', 0, 'note']), ['n', { en: 'n', de: 'N' }]);
});

test('shownOps are the ops in flight, then those queued', () => {
	const a = editOp('hike', ['summary'], 'A');
	const b = editOp('hike', ['checked'], '2026-11-01');
	assert.deepEqual(shownOps({ inFlight: () => [a], pending: () => [b] }), [a, b]);
});

test('localFacts keeps a null text: the visit removes the hike\'s text', () => {
	const d = doc({ summary: 'Hike' }, { summary: 'Visit', checked: '2026-10-31' });
	assert.deepEqual(localFacts(d, [editOp('post', ['summary'], null)], 'post'), { summary: null, checked: '2026-10-31' });
	assert.deepEqual(localFacts(doc({ summary: 'Hike' }), [editOp('post', ['summary'], null)], 'post'), { summary: null });
});

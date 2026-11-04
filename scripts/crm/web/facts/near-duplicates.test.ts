import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFactsLibrary } from '$lib/hikes/facts-library.server';
import { hikeGroups, mergeId, type NearDuplicateGroup } from './near-duplicates';
import type { LibraryState } from './shared';

const group = (kind: string, key: string, files: string[]) => ({ id: `${kind}|${key}`, kind, key, entries: files.map((file) => ({ file, path: kind === 'stops' ? 'stops[0]' : 'access.transport[1]', diff: [] })) }) as NearDuplicateGroup;
const TRAIN = { mode: 'train', from: 'Munich', to: { name: 'Gmund' }, line: 'RB 57' };

test('a hike\'s near-duplicates, and the id a merge proposes', () => {
	const rb57 = group('transport', 'train RB 57 Munich → Gmund', ['gassler_berg.hike.json', '2026-10-04-wasenkogel.md']);
	const hut = group('stops', 'way/1', ['a.hike.json', 'b.hike.json']);
	// This hike's sidecar or any of its posts, never a slug that only ends the same.
	assert.deepEqual(hikeGroups([rb57, hut], 'wasenkogel'), [rb57]);
	assert.deepEqual(hikeGroups([rb57, hut], 'kogel'), []);
	assert.deepEqual(hikeGroups([rb57, hut], 'b'), [hut]);
	// The id: the Plan 2 rule over this hike's entry, past the ids a hike uses; a stop's is its place's ref.
	const doc = { slug: 'wasenkogel', date: '2026-10-04', facts: { hike: null, post: { access: { transport: [{ mode: 'bus' }, TRAIN] } } } };
	const state = (usage: string[]): LibraryState => ({ version: 'v', library: { ...emptyFactsLibrary(), transport: { 'train-rb-57-gmund': {} } } as never, usage: { 'transport/train-rb-57-gmund': usage } });
	assert.equal(mergeId(rb57, doc, state([])), 'train-rb-57-gmund');
	assert.equal(mergeId(rb57, doc, state(['gassler_berg'])), 'train-rb-57-gmund-2');
	// A merge that stopped part way: the record its merged entries take, whatever this doc's entry would get.
	assert.equal(mergeId({ ...rb57, record: 'train-rb-57-gmund' }, doc, state(['gassler_berg'])), 'train-rb-57-gmund');
	assert.equal(mergeId(hut, { slug: 'b', date: null, facts: { hike: { stops: [{ at: 'Hut' }] }, post: null } }, state([])), 'way/1');
});

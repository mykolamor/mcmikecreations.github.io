import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheckpoint } from './checkpoint-snap';

const src = {
	others: [{ name: 'Bar', checkpoints: [[11.0003, 47.0] as [number, number]] }],
	nodes: [{ ref: 'node/1', name: 'Peak', lat: 47.0, lon: 11.00005 }]
};
const store = [{ ref: 'node/2', name: 'Hut', lat: 47.0, lon: 11.0001 }];

test("snap prefers another hike's checkpoint within 30 m, else a node, else the raw point", () => {
	const p = { lat: 47.0, lon: 11.0 };
	// checkpoint is ~23 m away, the node ~3.8 m: the checkpoint still wins
	assert.deepEqual(resolveCheckpoint(p, src, store), { lon: 11.0003, lat: 47.0, label: 'Bar checkpoint' });
	assert.deepEqual(resolveCheckpoint(p, { ...src, others: [] }, store), { lon: 11.00005, lat: 47.0, label: 'Peak' });
	assert.deepEqual(resolveCheckpoint(p, { ...src, others: [], nodes: [] }, store), { lon: 11.0001, lat: 47.0, label: 'Hut' });
	assert.deepEqual(resolveCheckpoint({ lat: 47.0000004, lon: 11.0000004 }, { others: [], nodes: [] }, []), { lon: 11, lat: 47, label: null });
	// beyond 30 m: raw
	assert.equal(resolveCheckpoint({ lat: 47.01, lon: 11 }, src, store).label, null);
});

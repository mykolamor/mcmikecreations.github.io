// Run with: node_modules/.bin/jiti src/lib/data/osm-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRef, resolveSidecar } from './osm-store.js';
import type { OsmEntry, RawHikeMeta } from './map-info';

const STORE: Record<string, OsmEntry> = {
	'node/7': {
		lat: 1,
		lon: 2,
		demEle: 8091.2,
		tags: { name: 'अन्नपूर्ण', ele: '8091', fixme: 'x' },
		local: { name: 'Annapurna I', fixme: null, visited: 'no' },
		fetched: '2026-10-26'
	},
	'node/3': { lat: 1, lon: 2, tags: { phone: 'vienna-1' }, fetched: 'x' },
	'way/4': { lat: 3, lon: 4, tags: { phone: 'rifugio-2', name: 'R' }, local: { name: 'Rifugio', phone: 'local-3' }, fetched: 'x' }
};

test('a node resolves to the map shape, local tags overriding OSM ones and null hiding one', () => {
	assert.deepEqual(resolveRef('node/7', STORE, 'x.hike.json'), {
		ref: 'node/7',
		lat: 1,
		lon: 2,
		demEle: 8091.2,
		tags: { name: 'Annapurna I', ele: '8091', visited: 'no' }
	});
	// The store entry itself is untouched.
	assert.equal(STORE['node/7'].tags.name, 'अन्नपूर्ण');
});

test('an unknown or malformed ref names the source and the ref', () => {
	assert.throws(() => resolveRef('node/999', STORE, 'a.hike.json'), /a\.hike\.json: unknown OSM element node\/999/);
	assert.throws(() => resolveRef('peak/1', STORE, 'a.hike.json'), /a\.hike\.json: unknown OSM element peak\/1/);
});

test('resolveSidecar keeps node order, other keys, and runs formatTags after local', () => {
	const facts = { summary: { en: 'x' } };
	const formatTags = (tags: Record<string, any>) => ({ ...tags, phone: String(tags.phone).toUpperCase() });
	const raw = { name: 'H', nodes: ['way/4', 'node/3'], facts } as unknown as RawHikeMeta;
	const meta = resolveSidecar(raw, STORE, 'h.hike.json', { formatTags });
	assert.deepEqual(meta.nodes?.map((n) => [n.ref, n.tags]), [
		['way/4', { phone: 'LOCAL-3', name: 'Rifugio' }],
		['node/3', { phone: 'VIENNA-1' }]
	]);
	assert.equal(meta.facts, facts);
	assert.deepEqual(raw.nodes, ['way/4', 'node/3']);
});

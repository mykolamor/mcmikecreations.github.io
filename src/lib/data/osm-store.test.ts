// Run with: node_modules/.bin/jiti src/lib/data/osm-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REF_RE, resolveRef, resolveSidecar } from './osm-store.js';
import type { OsmEntry, RawHikeMeta } from './map-info';

const STORE: Record<string, OsmEntry> = {
	'node/627403025': { lat: 47.38, lon: 10.96, demEle: 1481.6, local: { visited: 'no' }, tags: { name: 'Isentalkopfbahn' }, fetched: '2026-10-26' },
	'node/2': { lat: 1, lon: 2, tags: { name: 'Two' }, fetched: '2026-10-26' },
	'way/42': { lat: 47.1, lon: 11.2, tags: { name: 'Hut' }, fetched: '2026-10-26' }
};

test('a node resolves to the map shape, visited back in its tags', () => {
	assert.deepEqual(resolveRef('node/627403025', STORE, 'x.hike.json'), {
		ref: 'node/627403025',
		lat: 47.38,
		lon: 10.96,
		demEle: 1481.6,
		tags: { name: 'Isentalkopfbahn', visited: 'no' }
	});
	// The store entry itself is untouched.
	assert.equal(STORE['node/627403025'].tags.visited, undefined);
});

test('a way resolves with its typed ref and no bare number', () => {
	const way = resolveRef('way/42', STORE, 'x');
	assert.equal('id' in way, false);
	assert.equal(way.ref, 'way/42');
	assert.equal('demEle' in way, false);
});

test('an unknown or malformed ref names the source and the ref', () => {
	assert.throws(() => resolveRef('node/999', STORE, 'a.hike.json'), /a\.hike\.json: unknown OSM element node\/999/);
	assert.throws(() => resolveRef('peak/1', STORE, 'a.hike.json'), /a\.hike\.json: unknown OSM element peak\/1/);
	assert.ok(REF_RE.test('relation/7'));
});

test('resolveSidecar keeps node order and leaves other keys alone', () => {
	const facts = { summary: { en: 'x' } };
	const raw = { name: 'H', nodes: ['node/2', 'way/42'], facts } as unknown as RawHikeMeta;
	const meta = resolveSidecar(raw, STORE, 'h.hike.json');
	assert.deepEqual(meta.nodes?.map((n) => n.ref), ['node/2', 'way/42']);
	assert.equal(meta.facts, facts);
	assert.deepEqual(raw.nodes, ['node/2', 'way/42']);
});

test('a sidecar without nodes stays without', () => {
	const meta = resolveSidecar({ name: 'H' } as unknown as RawHikeMeta, STORE, 'h');
	assert.equal('nodes' in meta, false);
});

test('local tags override OSM tags and null hides one', () => {
	const store = { 'node/7': { lat: 1, lon: 2, tags: { name: 'अन्नपूर्ण', ele: '8091', fixme: 'x' }, local: { name: 'Annapurna I', fixme: null, visited: 'no' }, fetched: '2026-10-26' } };
	const node = resolveRef('node/7', store, 'test');
	assert.deepEqual(node.tags, { name: 'Annapurna I', ele: '8091', visited: 'no' });
});

test('entries without local resolve as before', () => {
	assert.deepEqual(resolveRef('node/2', STORE, 't').tags, { name: 'Two' });
});

test('formatTags runs after local is applied', () => {
	const store = { 'node/8': { lat: 1, lon: 2, tags: { phone: 'a', name: 'N' }, local: { phone: 'b', name: null }, fetched: 'x' } };
	const node = resolveRef('node/8', store, 't', { formatTags: (tags) => ({ ...tags, phone: `<${tags.phone}>` }) });
	assert.deepEqual(node.tags, { phone: '<b>' });
});

test('resolveSidecar applies formatTags to every resolved node', () => {
	const store: Record<string, OsmEntry> = {
		'node/3': { lat: 1, lon: 2, tags: { phone: 'vienna-1' }, fetched: 'x' },
		'way/4': { lat: 3, lon: 4, tags: { phone: 'rifugio-2' }, local: { name: 'Rifugio' }, fetched: 'x' }
	};
	const formatTags = (tags: Record<string, any>) => ({ ...tags, phone: String(tags.phone).toUpperCase() });
	const raw = { name: 'H', nodes: ['node/3', 'way/4'] } as unknown as RawHikeMeta;
	const meta = resolveSidecar(raw, store, 'h.hike.json', { formatTags });
	assert.deepEqual(meta.nodes?.map((n) => n.tags), [
		{ phone: 'VIENNA-1' },
		{ phone: 'RIFUGIO-2', name: 'Rifugio' }
	]);
});

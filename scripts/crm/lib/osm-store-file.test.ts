import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStore, writeStore, serializeStore } from './osm-store-file';

const REAL = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/osm.json', import.meta.url));

test('the real store round-trips byte-for-byte', () => {
	const dir = mkdtempSync(join(tmpdir(), 'osm-store-'));
	const out = join(dir, 'osm.json');
	writeStore(out, readStore(REAL));
	assert.equal(readFileSync(out, 'utf-8'), readFileSync(REAL, 'utf-8'));
});

test('sorts refs and entry keys, keeps whole floats and non-ASCII', () => {
	const text = serializeStore({
		'way/2': { fetched: 'd', tags: { name: 'Śnieżka' }, lat: 1.5, lon: 2, demEle: readStoreFloat() },
		'node/10': { lat: 1, lon: 2, tags: {}, fetched: 'd' },
		'node/9': { lat: 1, lon: 2, tags: {}, fetched: 'd' }
	});
	assert.deepEqual(Object.keys(JSON.parse(text)), ['node/9', 'node/10', 'way/2']);
	assert.match(text, /"demEle": 1577\.0,\n {4}"tags": \{\n {6}"name": "Śnieżka"/);
	assert.match(text, /"tags": \{\}/);
	assert.ok(text.endsWith('}\n'));
});

function readStoreFloat() {
	const dir = mkdtempSync(join(tmpdir(), 'osm-store-'));
	const p = join(dir, 'x.json');
	writeFileSync(p, '{"node/1":{"demEle":1577.0}}');
	return readStore(p)['node/1'].demEle;
}

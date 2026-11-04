import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractLibrary } from './extract-facts-library';
import { repoPaths } from '../server/paths';

const REAL_ROOT = path.resolve(__dirname, '../../..');

const OSM = {
	'node/1': { lat: 47.5, lon: 11.1, tags: { name: 'Hut' } },
	'node/2': { lat: 47.51, lon: 11.11, tags: { name: 'Lower Hut' } }
};

/** A sidecar in the real files' layout: two-space indent. */
function sidecar(facts: Record<string, unknown>, nodes = ['node/1', 'node/2']): string {
	return JSON.stringify({ name: 'Test', origin: { lat: 47.5, lon: 11.1 }, height: 768, nodes, facts }, null, 2) + '\n';
}

/** A temp repo with these files in the markdown dir, the OSM store above and, optionally, a library. */
function repo(files: Record<string, string>, library?: unknown): string {
	const root = mkdtempSync(path.join(tmpdir(), 'facts-library-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	writeFileSync(p.osmStore, JSON.stringify(OSM, null, 2));
	if (library) writeFileSync(p.factsLibrary, JSON.stringify(library, null, '\t') + '\n');
	for (const [name, text] of Object.entries(files)) writeFileSync(path.join(p.markdown, name), text);
	return root;
}

const read = (root: string, name: string) => readFileSync(path.join(repoPaths(root).markdown, name), 'utf8');
const library = (root: string) => JSON.parse(readFileSync(repoPaths(root).factsLibrary, 'utf8'));
const snapshot = (root: string) => {
	const p = repoPaths(root);
	return [...readdirSync(p.markdown).sort().map((n) => read(root, n)), existsSync(p.factsLibrary) ? readFileSync(p.factsLibrary, 'utf8') : ''];
};

const HUT = { at: 'Hut', kind: 'restaurant', food: true, note: { en: 'Closed Mondays.', de: 'Montags Ruhetag.' }, checked: '2026-10-18' };
const TRAIN = { mode: 'train', from: { en: 'Munich Central Station', de: 'München Hbf' }, to: { name: { en: 'Oberau' } }, line: 'RB 6', duration: 109 };

test('identical stops in two hikes become one record and two bare stops', () => {
	// The same entry, in another key order in the second hike.
	const { at, ...rest } = HUT;
	const root = repo({ 'a.hike.json': sidecar({ stops: [HUT, { at: 'Lower Hut', kind: 'kiosk' }] }), 'b.hike.json': sidecar({ stops: [{ ...rest, at }] }) });
	const before = read(root, 'a.hike.json');
	const r = extractLibrary(root);
	assert.deepEqual([r.records, r.references, r.files], [1, 2, ['a.hike.json', 'b.hike.json', 'facts-library.json']]);
	assert.deepEqual(library(root).stops, { 'node/1': { kind: 'restaurant', food: true, note: HUT.note, checked: '2026-10-18' } });
	// Only the entry's own text changes; the other stop keeps every byte.
	const entry = /\n {6}\{\n {8}"at": "Hut",[\s\S]*?\n {6}\}/.exec(before)![0];
	assert.equal(read(root, 'a.hike.json'), before.replace(entry, '\n      {\n        "at": "Hut"\n      }'));
	assert.match(read(root, 'b.hike.json'), /"stops": \[\n {6}\{\n {8}"at": "Hut"\n {6}\}\n {4}\]/);
});

test('identical transport becomes a used record', () => {
	// One copy in a sidecar, one in a post, written in flow style.
	const post = '---\ntitle: B\nfacts:\n  access:\n    # the train\n    transport:\n      - {mode: train, from: {en: Munich Central Station, de: München Hbf}, to: {name: {en: Oberau}}, line: RB 6, duration: 109}\n---\nBody\n';
	const root = repo({ 'a.hike.json': sidecar({ access: { transport: [TRAIN] } }), 'b.hike.json': sidecar({ summary: 'B' }), '2026-01-02-b.md': post });
	const r = extractLibrary(root);
	assert.deepEqual([r.records, r.references], [1, 2]);
	assert.deepEqual(library(root).transport, { 'train-rb-6-oberau': TRAIN });
	assert.match(read(root, 'a.hike.json'), /"transport": \[\n {8}\{\n {10}"use": "train-rb-6-oberau"\n {8}\}\n {6}\]/);
	assert.equal(read(root, '2026-01-02-b.md'), '---\ntitle: B\nfacts:\n  access:\n    # the train\n    transport:\n      - {use: train-rb-6-oberau}\n---\nBody\n');
});

test('entries that differ only in checked are near-duplicates, not merged', () => {
	const parking = { name: { en: 'Station parking' }, at: 'Hut', size: 'small' };
	const files = { 'a.hike.json': sidecar({ access: { parking: [{ ...parking, checked: '2026-01-01' }] } }), 'b.hike.json': sidecar({ access: { parking: [{ ...parking, checked: '2026-02-02' }] } }) };
	const root = repo(files);
	const r = extractLibrary(root);
	assert.deepEqual([r.records, r.references, r.files], [0, 0, []]);
	assert.deepEqual(snapshot(root), [files['a.hike.json'], files['b.hike.json'], '']);
	const groups = [
		{
			kind: 'parking',
			key: 'Station parking at Hut',
			entries: [
				{ file: 'a.hike.json', path: 'access.parking[0]', diff: ['checked: "2026-01-01"'] },
				{ file: 'b.hike.json', path: 'access.parking[0]', diff: ['checked: "2026-02-02"'] }
			]
		}
	];
	assert.deepEqual(r.nearDuplicates, groups);
	assert.deepEqual(JSON.parse(readFileSync(path.join(repoPaths(root).crmData, 'near-duplicates.json'), 'utf8')), groups);
});

test('a stop not on OSM stays inline', () => {
	const stop = { at: 'Nowhere Inn', kind: 'restaurant', food: true };
	const files = { 'a.hike.json': sidecar({ stops: [stop] }), 'b.hike.json': sidecar({ stops: [stop] }) };
	const root = repo(files);
	const r = extractLibrary(root);
	assert.deepEqual([r.records, r.references, r.files], [0, 0, []]);
	assert.deepEqual(snapshot(root), [files['a.hike.json'], files['b.hike.json'], '']);
	assert.deepEqual(r.notConverted, ['stops "nowhere-inn" (a.hike.json stops[0], b.hike.json stops[0]): its at resolves to no OSM ref, or to different ones']);
});

test('id clashes get -2', () => {
	// The library holds the id already, and two new groups want it.
	const old = { stops: {}, transport: { 'train-rb-6-oberau': { mode: 'bus' } }, lifts: {}, parking: {}, tickets: {} };
	const other = { ...TRAIN, note: { en: 'Change in Tutzing.' } };
	const root = repo({
		'a.hike.json': sidecar({ access: { transport: [TRAIN] } }),
		'b.hike.json': sidecar({ access: { transport: [TRAIN] } }),
		'c.hike.json': sidecar({ access: { transport: [other] } }),
		'd.hike.json': sidecar({ access: { transport: [other] } })
	}, old);
	const r = extractLibrary(root);
	assert.deepEqual([r.records, r.references], [2, 4]);
	assert.deepEqual(library(root).transport, { 'train-rb-6-oberau': { mode: 'bus' }, 'train-rb-6-oberau-2': TRAIN, 'train-rb-6-oberau-3': other });
	assert.match(read(root, 'b.hike.json'), /"use": "train-rb-6-oberau-2"/);
	assert.match(read(root, 'd.hike.json'), /"use": "train-rb-6-oberau-3"/);
});

test('the library pass is a no-op on converted data', () => {
	const root = repo({ 'a.hike.json': sidecar({ stops: [HUT], access: { transport: [TRAIN] } }), 'b.hike.json': sidecar({ stops: [HUT], access: { transport: [TRAIN] } }) });
	assert.equal(extractLibrary(root).references, 4);
	const once = snapshot(root);
	const again = extractLibrary(root);
	assert.deepEqual([again.records, again.references, again.files, again.notConverted, again.nearDuplicates], [0, 0, [], [], []]);
	assert.deepEqual(snapshot(root), once);
});

// Reads the live repo (a copy of it): its result depends on the author's data, not only on the code.
test('real-data idempotency check: a second library pass over a copy of the live files changes nothing', () => {
	const real = mkdtempSync(path.join(tmpdir(), 'facts-library-real-'));
	const src = repoPaths(REAL_ROOT);
	const dst = repoPaths(real);
	for (const key of ['markdown', 'places', 'gpx'] as const) if (existsSync(src[key])) cpSync(src[key], dst[key], { recursive: true });
	for (const key of ['osmStore', 'factsLibrary'] as const) if (existsSync(src[key])) cpSync(src[key], dst[key]);
	extractLibrary(real);
	const converted = snapshot(real);
	const second = extractLibrary(real);
	assert.deepEqual([second.records, second.references, second.files], [0, 0, []]);
	assert.deepEqual(snapshot(real), converted);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPaths } from '../server/paths';
import type { Terrain } from '../server/terrain';
import { backfillTerrain } from './terrain';
import { parseArgs } from './index';
import { recorder } from './test-output';

/** 1577 m north of 47°, 1350.4 m south of it; off the tiles (null) east of 20°. */
const fake: Terrain = { height: (lat, lon) => (lon > 20 ? null : lat >= 47 ? 1577 : 1350.4) };

const POST = '2024-01-01-foo.md';
const FRONT = [
	'---',
	'title: T # kept',
	'images:',
	"  a.jpg: {w: 4, h: 3, lat: 47.5, lon: 11.25, taken: '2024-01-01T10:00:00+01:00', blur: 'data:x'}",
	"  b.jpg: {w: 4, h: 3, lat: 46.5, lon: 11.25, demEle: 1200.1, blur: 'data:y'}",
	"  c.jpg: {w: 4, h: 3, blur: 'data:z'}",
	"  d.jpg: {w: 4, h: 3, lat: 28.6, lon: 83.9, blur: 'data:w'}",
	'---',
	'Body',
	''
].join('\n');
const PLACE = "---\ntitle: P\ndescription: D\nimages:\n  2024-01-01-01.jpg: {w: 4, h: 3, lat: 47.1, lon: 11.0, demEle: 1577.0}\n---\nText\n";
const STORE = '{\n  "node/2": {\n    "lat": 46.5,\n    "lon": 11.0,\n    "tags": {\n      "ele": "1349"\n    }\n  },\n  "node/1": {\n    "lat": 47.5,\n    "lon": 11.0,\n    "demEle": 1500.0,\n    "tags": {\n      "ele": "1580"\n    }\n  },\n  "way/3": {\n    "lat": 28.6,\n    "lon": 83.9,\n    "tags": {}\n  }\n}\n';
const SIDECAR = [
	'{',
	'  "name": "Foo",',
	'  "origin": {',
	'    "lat": 47.5,',
	'    "lon": 11.0',
	'  },',
	'  "checkpoints": [[11.1, 47.5]],',
	'  "facts": {',
	'    "start": {',
	'      "lat": 47.6,',
	'      "lon": 11.3,',
	'      "name": {"en": "Bus stop", "de": "Haltestelle"}',
	'    },',
	'    "parking": [',
	'      {',
	'        "at": {"ref": "way/1", "name": "P"},',
	'        "size": "small"',
	'      }',
	'    ],',
	'    "end": {',
	'      "lat": 46.5,',
	'      "lon": 11.3,',
	'      "demEle": 1.5,',
	'      "name": "Village"',
	'    }',
	'  }',
	'}',
	''
].join('\n');
const POST_FACTS = "---\ntitle: T\nfacts:\n  start: {lat: 47.6, lon: 11.3}\n---\nBody\n";

function setup(front = FRONT) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-terrain-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.places]) mkdirSync(d, { recursive: true });
	writeFileSync(join(p.markdown, POST), front);
	writeFileSync(join(p.markdown, 'foo.hike.json'), SIDECAR);
	writeFileSync(join(p.places, 'spot.md'), PLACE);
	writeFileSync(p.osmStore, STORE);
	return { root, p, post: join(p.markdown, POST), sidecar: join(p.markdown, 'foo.hike.json'), place: join(p.places, 'spot.md') };
}

const go = (root: string, argv: string[]) => {
	const out = recorder();
	return backfillTerrain(root, parseArgs(['terrain', ...argv]), out, fake).then((code) => ({ code, out }));
};

const snapshot = (s: ReturnType<typeof setup>) => [s.post, s.sidecar, s.place, s.p.osmStore].map((f) => readFileSync(f, 'utf8'));

test('photos with a position get demEle, others are untouched', async () => {
	const s = setup();
	const { code, out } = await go(s.root, ['--no-nodes']);
	assert.equal(code, 0);
	assert.equal(
		readFileSync(s.post, 'utf8'),
		FRONT.replace('lon: 11.25, taken', 'lon: 11.25, demEle: 1577.0, taken').replace('demEle: 1200.1', 'demEle: 1350.4')
	);
	assert.equal(readFileSync(s.place, 'utf8'), PLACE, 'an equal value is left as written');
	assert.deepEqual(out.changes, ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md: set demEle on 2 image(s)']);
	assert.deepEqual(out.summaries, ['photos: 2 image(s) updated across 1 post(s) and 1 place doc(s)']);
});

test('osm.json demEle is written as the Python writer does (1577.0)', async () => {
	const s = setup();
	const { code, out } = await go(s.root, ['--no-photos']);
	assert.equal(code, 0);
	assert.equal(
		readFileSync(s.p.osmStore, 'utf8'),
		'{\n  "node/1": {\n    "lat": 47.5,\n    "lon": 11.0,\n    "demEle": 1577.0,\n    "tags": {\n      "ele": "1580"\n    }\n  },\n  "node/2": {\n    "lat": 46.5,\n    "lon": 11.0,\n    "demEle": 1350.4,\n    "tags": {\n      "ele": "1349"\n    }\n  },\n  "way/3": {\n    "lat": 28.6,\n    "lon": 83.9,\n    "tags": {}\n  }\n}\n'
	);
	assert.ok(out.changes.includes('static/_projects/data-viz/hikes/osm.json: set demEle on 2 element(s)'));
	assert.ok(out.summaries.includes('store: 2 element(s) updated across 1 store'));
});

test("facts places in a sidecar get demEle, a post's facts don't", async () => {
	const s = setup(POST_FACTS);
	const { code, out } = await go(s.root, ['--no-photos']);
	assert.equal(code, 0);
	assert.equal(
		readFileSync(s.sidecar, 'utf8'),
		SIDECAR.replace('"lon": 11.3,\n      "name": {', '"lon": 11.3,\n      "demEle": 1577.0,\n      "name": {').replace('"demEle": 1.5', '"demEle": 1350.4')
	);
	assert.equal(readFileSync(s.post, 'utf8'), POST_FACTS);
	assert.ok(out.changes.includes('static/_projects/data-viz/hikes/markdown/foo.hike.json: set demEle on 2 facts place(s)'));
	assert.ok(out.summaries.includes('facts: 2 facts place(s) updated across 1 file(s)'));
});

test('--no-nodes / --no-photos skip their part', async () => {
	const s = setup();
	const before = snapshot(s);
	await go(s.root, ['--no-nodes', '--no-photos']);
	assert.deepEqual(snapshot(s), before);
	await go(s.root, ['--no-photos']);
	const nodes = snapshot(s);
	assert.equal(nodes[0], before[0], '--no-photos leaves the post');
	assert.notEqual(nodes[3], before[3]);
	const t = setup();
	await go(t.root, ['--no-nodes']);
	const photos = snapshot(t);
	assert.notEqual(photos[0], before[0]);
	assert.deepEqual([photos[1], photos[3]], [before[1], before[3]], '--no-nodes leaves the sidecar and the store');
});

test('--dry-run prints and writes nothing', async () => {
	const s = setup();
	const before = snapshot(s);
	const { code, out } = await go(s.root, ['--dry-run']);
	assert.equal(code, 0);
	assert.equal(out.changes.length, 3);
	assert.deepEqual(snapshot(s), before);
	assert.ok(out.summaries.every((l) => l.endsWith(' (dry run, nothing written)')));
});

test('a second run changes nothing', async () => {
	const s = setup();
	const before = snapshot(s);
	await go(s.root, []);
	const first = snapshot(s);
	assert.notDeepEqual(first, before, 'the first run writes');
	const { code, out } = await go(s.root, []);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, []);
	assert.deepEqual(snapshot(s), first);
});

test('an unreadable sidecar fails naming it, the rest still run', async () => {
	const s = setup();
	writeFileSync(join(s.p.markdown, 'bad.hike.json'), '{ "facts": ');
	const { code, out } = await go(s.root, []);
	assert.equal(code, 1);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], /^static\/_projects\/data-viz\/hikes\/markdown\/bad\.hike\.json: /);
	assert.ok(out.changes.some((c) => c.includes('foo.hike.json')));
});

test('a track-located entry in the Python order gains demEle after lon', async () => {
	const line = "  a.jpg: {w: 4, h: 3, taken: '2024-01-01T10:00:00+01:00', lat: 47.5, lon: 11.25, located: track, blur: 'data:x'}";
	const s = setup(`---\ntitle: T\nimages:\n${line}\n---\nBody\n`);
	assert.equal(await backfillTerrain(s.root, parseArgs(['terrain', '--no-nodes']), recorder(), fake), 0);
	assert.equal(readFileSync(s.post, 'utf8').split('\n')[3], line.replace('lon: 11.25,', 'lon: 11.25, demEle: 1577.0,'));
});

test('terrain fills demEle for library places and a second run changes nothing', async () => {
	const s = setup();
	const library = (to: string) => `{
	"stops": {},
	"transport": {
		"bus-9": {
			"mode": "bus",
			"from": "Garmisch",
			"to": ${to}
		}
	},
	"lifts": {
		"alpspitzbahn": {
			"name": "Alpspitzbahn",
			"from": {
				"ref": "node/1"
			},
			"to": {
				"lat": 46.5,
				"lon": 11,
				"demEle": 1.5
			}
		}
	},
	"parking": {},
	"tickets": {}
}
`;
	const before = library('{\n\t\t\t\t"lat": 47.5,\n\t\t\t\t"lon": 11,\n\t\t\t\t"name": "Hammersbach"\n\t\t\t}');
	writeFileSync(s.p.factsLibrary, before);
	const { code, out } = await go(s.root, ['--no-photos']);
	assert.equal(code, 0);
	const after = library('{\n\t\t\t\t"lat": 47.5,\n\t\t\t\t"lon": 11,\n\t\t\t\t"name": "Hammersbach",\n\t\t\t\t"demEle": 1577\n\t\t\t}').replace('"demEle": 1.5', '"demEle": 1350.4');
	assert.equal(readFileSync(s.p.factsLibrary, 'utf8'), after);
	assert.ok(out.changes.includes('static/_projects/data-viz/hikes/facts-library.json: set demEle on 2 library place(s)'));
	assert.ok(out.summaries.includes('library: 2 library place(s) updated across 1 file'));
	const again = await go(s.root, ['--no-photos']);
	assert.equal(again.code, 0);
	assert.deepEqual(again.out.changes, []);
	assert.equal(readFileSync(s.p.factsLibrary, 'utf8'), after);
	// An empty library is left as it is.
	const t = setup();
	const empty = '{\n\t"stops": {},\n\t"transport": {},\n\t"lifts": {},\n\t"parking": {},\n\t"tickets": {}\n}\n';
	writeFileSync(t.p.factsLibrary, empty);
	assert.equal((await go(t.root, ['--no-photos'])).code, 0);
	assert.equal(readFileSync(t.p.factsLibrary, 'utf8'), empty);
});

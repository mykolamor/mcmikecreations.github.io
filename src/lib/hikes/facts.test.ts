// Run with: node_modules/.bin/jiti src/lib/hikes/facts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpxPoints, readHikeFacts, summariseGpxRoute, type ReadFactsInput } from './facts.server';
import { ENUMS, LANGS, sacRank } from './facts-schema';
import { FACTS_STRINGS } from './facts-strings';

// A straight route north along lon 11.0: 11 points ~1.11 km apart, climbing 100 m each.
const COORDS = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const NODES = [
	{ id: 1, lat: 47.02, lon: 11.0, tags: { name: 'Knorrhütte', ele: '1200', phone: '+49 1', website: 'https://hut.example' } },
	{ id: 2, lat: 47.05, lon: 11.0, tags: { name: 'Gatterl', ele: '1500' } },
	{ id: 3, lat: 47.1, lon: 11.0, tags: { name: 'Gipfel', ele: '2000' } }
];

const GPX = `<gpx><trk><trkseg>
	<trkpt lat="47.02" lon="11.0"><ele>1200</ele></trkpt>
	<trkpt lon="11.01" lat="47.02"><ele>1150</ele></trkpt>
	<trkpt lat="47.02" lon="11.01"><ele>1150</ele></trkpt>
	<trkpt lat="47.03" lon="11.01"><ele>1000</ele></trkpt>
</trkseg></trk></gpx>`;

function read(post: unknown, sidecar: unknown = undefined) {
	const input: ReadFactsInput = {
		post, sidecar, postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, coords: COORDS, distanceFactor: 1,
		readGpx: (path) => (path === '/gpx/out.gpx' ? GPX : null)
	};
	return readHikeFacts(input);
}

test('no facts anywhere gives null', () => {
	assert.equal(read(undefined).facts, null);
});

test('text, dates and places are normalized', () => {
	const { facts, warnings } = read({
		checked: new Date('2026-07-19T00:00:00Z'),
		summary: 'A walk',
		bailouts: [{ at: 'Gatterl', to: { en: 'Valley', de: 'Tal' } }, { at: 'knorrhutte' }]
	});
	assert.deepEqual(warnings, []);
	assert.equal(facts!.checked, '2026-07-19');
	assert.deepEqual(facts!.summary, { en: 'A walk' });
	// Sorted by km: Knorrhütte (~2.2 km) before Gatterl (~5.6 km).
	assert.equal(facts!.bailouts![0].at.name.en, 'Knorrhütte');
	assert.equal(facts!.bailouts![0].at.node, 1);
	assert.equal(facts!.bailouts![0].at.ele, 1200);
	assert.ok(Math.abs(facts!.bailouts![0].at.km! - 2.22) < 0.05);
	assert.deepEqual(facts!.bailouts![1].to, { en: 'Valley', de: 'Tal' });
});

test('km and lat/lon places resolve; unknown names warn and stay plain text', () => {
	const { facts, warnings } = read({
		hazards: [
			{ kind: 'rockfall', at: 'km 3' },
			{ kind: 'cold', at: { lat: 47.04, lon: 11.0, name: 'Bench' } },
			{ kind: 'cattle', at: 'Nowhere Alm' }
		]
	});
	const [a, b, c] = facts!.hazards!;
	assert.equal(a.at!.km, 3);
	assert.ok(Math.abs(a.at!.lat! - 47.027) < 0.001);
	assert.ok(Math.abs(b.at!.km! - 4.45) < 0.05);
	assert.deepEqual(b.at!.name, { en: 'Bench' });
	assert.equal(c.at!.resolved, false);
	assert.equal(c.at!.km, undefined);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /hazards\[2\]\.at: place "Nowhere Alm"/);
});

test('a named start that is no node does not warn', () => {
	const { facts, warnings } = read({ route: { start: { name: 'Ehrwald Bahnhof' }, end: 'Gipfel' } });
	assert.deepEqual(warnings, []);
	assert.deepEqual(facts!.route!.start, { name: { en: 'Ehrwald Bahnhof' }, resolved: true });
	assert.equal(facts!.route!.end!.node, 3);
});

test('malformed data throws with the source and path', () => {
	assert.throws(() => read({ hazard: [] }), /post\.md: : unknown key "hazard"/);
	assert.throws(() => read({ hazards: [{ kind: 'dragons' }] }), /hazards\[0\]\.kind: unknown value "dragons"/);
	assert.throws(() => read({ conditions: { start: 1230 } }), /quote it/);
	assert.throws(() => read({ difficulty: { sac: 'T7' } }), /SAC grade/);
	assert.throws(() => read({ bailouts: [{ to: 'x' }] }), /bailouts\[0\]\.at: required/);
	assert.throws(() => read({ summary: { en: 'x', fr: 'y' } }), /unknown language "fr"/);
	assert.throws(() => read({ season: { best: [13] } }), /month/);
	assert.throws(() => read({ summary: { de: 'Nur Deutsch' } }), /summary: text has a translation but no `en`/);
});

test('an enum value the list lacks is fine with a label', () => {
	const { facts } = read({ hazards: [{ kind: 'dragons', label: 'Dragons' }] });
	assert.equal(facts!.hazards![0].kind, 'dragons');
});

test('the post deep-merges over the sidecar', () => {
	const sidecar = {
		summary: 'Route text',
		difficulty: { sac: 'T3', note: 'Sidecar note' },
		season: { best: [7, 8, 9] },
		hazards: [
			{ kind: 'snowfield', at: 'Gatterl', note: 'Spikes' },
			{ kind: 'rockfall', at: 'Gipfel' },
			{ kind: 'cattle', at: 'Knorrhütte' }
		],
		access: { carFree: 'yes', note: 'Train' },
		conditions: { crowding: 'busy' }
	};
	const post = {
		summary: { de: 'Routentext' },
		difficulty: { sac: 'T4' },
		season: { best: [8] },
		hazards: [
			{ kind: 'snowfield', at: { node: 2 }, severity: 'high' },
			{ kind: 'cattle', at: 'Knorrhütte', remove: true },
			{ kind: 'cold' }
		],
		access: { note: null }
	};
	const { facts, warnings } = read(post, sidecar);
	assert.deepEqual(facts!.summary, { en: 'Route text', de: 'Routentext' });
	assert.equal(facts!.difficulty!.sac, 'T4');
	assert.equal(facts!.difficulty!.sacSource, 'manual');
	assert.deepEqual(facts!.difficulty!.note, { en: 'Sidecar note' });
	assert.deepEqual(facts!.season!.best, [8]);
	assert.deepEqual(facts!.hazards!.map((h) => h.kind), ['snowfield', 'rockfall', 'cold']);
	assert.equal(facts!.hazards![0].severity, 'high');
	assert.deepEqual(facts!.hazards![0].note, { en: 'Spikes' });
	assert.deepEqual(facts!.access, { carFree: 'yes' });
	// Sidecar conditions are ignored.
	assert.equal(facts!.conditions, undefined);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /side\.hike\.json: conditions/);
});

test('remove that matches nothing warns', () => {
	const { facts, warnings } = read({ hazards: [{ kind: 'cold', remove: true }] }, { hazards: [{ kind: 'heat' }] });
	assert.deepEqual(facts!.hazards!.map((h) => h.kind), ['heat']);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /remove/);
});

test('the overall SAC grade is computed from sections and non-optional legs', () => {
	const { facts } = read({
		difficulty: { sections: [{ to: 'Gatterl', sac: 'T2' }, { from: 'Gatterl', sac: 'T3+' }] },
		legs: [{ to: 'Knorrhütte', sac: 'T5', optional: true }, { to: 'Gipfel', sac: 'T3' }]
	});
	assert.equal(facts!.difficulty!.sac, 'T3+');
	assert.equal(facts!.difficulty!.sacSource, 'computed');
});

test('a hand-written SAC easier than the sections warns', () => {
	const { facts, warnings } = read({ difficulty: { sac: 'T2', sections: [{ sac: 'T4' }] } });
	assert.equal(facts!.difficulty!.sac, 'T2');
	assert.match(warnings[0], /easier than/);
});

test('a stop on a node falls back to its OSM contact details', () => {
	const { facts } = read({ stops: [{ at: 'Knorrhütte' }, { at: 'Gatterl', phone: '+43 2' }] });
	assert.equal(facts!.stops![0].phone, '+49 1');
	assert.deepEqual(facts!.stops![0].booking, { url: 'https://hut.example' });
	assert.equal(facts!.stops![1].phone, '+43 2');
	assert.equal(facts!.stops![1].booking, undefined);
});

test('hidden: true switches the whole layer off, sidecar included, unvalidated', () => {
	assert.deepEqual(read({ hidden: true, hazards: [{ kind: 'dragons' }] }, { summary: 'x' }), { facts: null, warnings: [] });
	const { facts } = read({ hidden: false }, { summary: 'From the sidecar' });
	assert.deepEqual(facts!.summary, { en: 'From the sidecar' });
	assert.throws(() => read({ hidden: 'yes' }), /hidden: expected true or false/);
	// Only a post may hide the layer.
	assert.throws(() => read(undefined, { hidden: true }), /unknown key "hidden"/);
});

test('drones and protected areas are free text', () => {
	const { facts } = read({ drones: { en: 'Not near the lifts.', de: 'Nicht bei den Bahnen.' }, protectedAreas: 'NSG Reintal' });
	assert.deepEqual(facts!.drones, { en: 'Not near the lifts.', de: 'Nicht bei den Bahnen.' });
	assert.deepEqual(facts!.protectedAreas, { en: 'NSG Reintal' });
});

test('a bailout route is read from its GPX and summarised', () => {
	const { facts } = read({ bailouts: [{ at: 'Knorrhütte', route: '/gpx/out.gpx' }] });
	const r = facts!.bailouts![0].route!;
	assert.equal(r.url, '/gpx/out.gpx');
	// The duplicate point is dropped; lon-before-lat attributes still parse.
	assert.equal(r.coords.length, 3);
	assert.deepEqual(r.coords[1], [47.02, 11.01]);
	assert.ok(Math.abs(r.distance - 1870) < 20);
	assert.equal(r.ascent, 0);
	assert.equal(r.descent, 200);
	assert.ok(r.duration! > 0);
	assert.throws(() => read({ bailouts: [{ at: 'Knorrhütte', route: '/gpx/missing.gpx' }] }), /no GPX file at "\/gpx\/missing\.gpx"/);
	assert.throws(() => read({ bailouts: [{ at: 'Knorrhütte', route: 'out.txt' }] }), /served GPX path/);
	assert.throws(() => read({ bailouts: [{ at: 'Knorrhütte', route: '/../secret.gpx' }] }), /served GPX path/);
});

test('GPX routes without track points fall back to route points', () => {
	const pts = parseGpxPoints('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"><ele>5</ele></rtept></rte></gpx>');
	assert.deepEqual(pts, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4, ele: 5 }]);
	// Without elevation on every point there's no ascent or time.
	const r = summariseGpxRoute('/x.gpx', '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"><ele>5</ele></rtept></rte></gpx>');
	assert.equal(r!.ascent, undefined);
	assert.equal(r!.duration, undefined);
});

test('SAC grades order with modifiers', () => {
	assert.ok(sacRank('T3-') < sacRank('T3'));
	assert.ok(sacRank('T3+') < sacRank('T4-'));
	assert.equal(sacRank('A'), -1);
});

test('every enum value has a label in every language', () => {
	for (const lang of LANGS) {
		for (const [group, values] of Object.entries(ENUMS)) {
			for (const value of values) {
				const label = (FACTS_STRINGS[lang].enums as Record<string, Record<string, string>>)[group]?.[String(value)];
				assert.ok(label, `${lang}: ${group}.${value}`);
			}
		}
		for (const key of Object.keys(FACTS_STRINGS.en.labels)) {
			assert.ok((FACTS_STRINGS[lang].labels as Record<string, string>)[key], `${lang}: labels.${key}`);
		}
	}
});

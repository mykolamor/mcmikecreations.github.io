// Run with: node_modules/.bin/jiti src/lib/hikes/facts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpxPoints, readHikeFacts, type ReadFactsInput } from './facts.server';
import { ENUMS, LANGS, profileLegs, tableLegs } from './facts-schema';
import { FACTS_STRINGS } from './facts-strings';
import { buildFactsOverlay } from './facts-overlay';
import { t } from '../i18n/strings';
import EN_TABLE from './i18n/en.json';
import DE_TABLE from './i18n/de.json';

// A straight route north along lon 11.0: 11 points ~1.11 km apart, climbing 100 m each.
const COORDS = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const NODES = [
	{ ref: 'node/1', lat: 47.02, lon: 11.0, tags: { name: 'Knorrhütte', ele: '1200', phone: '+49 1', website: 'https://hut.example' } },
	{ ref: 'node/2', lat: 47.05, lon: 11.0, tags: { name: 'Gatterl', ele: '1500' } },
	{ ref: 'node/3', lat: 47.1, lon: 11.0, tags: { name: 'Gipfel', ele: '2000' } }
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

/** Like `read`, with a wider OSM store than the hike's own nodes. */
function readWithStore(post: unknown, storeNodes: ReadFactsInput['nodes']) {
	return readHikeFacts({
		post, sidecar: undefined, postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, storeNodes, coords: COORDS, distanceFactor: 1
	});
}

/** An old `difficulty.sections` entry as it reads in the route list: a profile-only entry. */
const band = (s: Record<string, unknown>) => ({ ...s, inTable: false, onProfile: true });

test('text, dates and places are normalized; unknown names warn and stay plain text', () => {
	assert.equal(read(undefined).facts, null);
	const { facts, warnings } = read({
		checked: new Date('2026-07-19T00:00:00Z'),
		summary: 'A walk',
		route: { start: { name: 'Ehrwald Bahnhof' } },
		bailouts: [{ at: 'Gatterl', to: { en: 'Valley', de: 'Tal' } }, { at: 'knorrhutte' }],
		hazards: [
			{ kind: 'rockfall', at: 'km 3' },
			{ kind: 'cold', at: { lat: 47.04, lon: 11.0, name: 'Bench' } },
			{ kind: 'cattle', at: 'Nowhere Alm' }
		]
	});
	assert.equal(facts!.checked, '2026-07-19');
	assert.deepEqual(facts!.summary, { en: 'A walk' });
	// A named start that is no node does not warn.
	assert.deepEqual(facts!.route!.start, { name: { en: 'Ehrwald Bahnhof' }, resolved: true });
	// Sorted by km: Knorrhütte (~2.2 km) before Gatterl (~5.6 km); the name matches loosely.
	assert.equal(facts!.bailouts![0].at.ref, 'node/1');
	assert.equal(facts!.bailouts![0].at.name.en, 'Knorrhütte');
	assert.equal(facts!.bailouts![0].at.ele, 1200);
	assert.ok(Math.abs(facts!.bailouts![0].at.km! - 2.22) < 0.05);
	const [a, b, c] = facts!.hazards!;
	assert.equal(a.at!.km, 3);
	assert.ok(Math.abs(a.at!.lat! - 47.027) < 0.001);
	assert.ok(Math.abs(b.at!.km! - 4.45) < 0.05);
	assert.equal(c.at!.resolved, false);
	assert.equal(c.at!.km, undefined);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /hazards\[2\]\.at: place "Nowhere Alm"/);
});

test('malformed data throws with the source and path', () => {
	assert.throws(() => read({ hazard: [] }), /post\.md: : unknown key "hazard"/);
	assert.throws(() => read({ hazards: [{ kind: 'dragons' }] }), /hazards\[0\]\.kind: unknown value "dragons"/);
	// An enum value the list lacks is fine with a label.
	assert.equal(read({ hazards: [{ kind: 'dragons', label: 'Dragons' }] }).facts!.hazards![0].kind, 'dragons');
	assert.throws(() => read({ conditions: { start: 1230 } }), /quote it/);
	assert.throws(() => read({ difficulty: { sac: 'T7' } }), /SAC grade/);
	assert.throws(() => read({ bailouts: [{ to: 'x' }] }), /bailouts\[0\]\.at: required/);
	assert.throws(() => read({ summary: { en: 'x', fr: 'y' } }), /summary: unknown language "fr" \(en, de, uk\)/);
	assert.throws(() => read({ season: { best: [13] } }), /month/);
	assert.throws(() => read({ summary: { de: 'Nur Deutsch' } }), /summary: text has a translation but no `en`/);
	assert.throws(() => read({ route: { countries: ['de'] } }), /route\.countries\[0\].*ISO/);
	assert.throws(() => read({ hazards: [{ kind: 'cattle', at: { node: 2 } }] }), /ref/);
	assert.throws(() => read({ hazards: [{ kind: 'cattle', at: { ref: 'peak/2' } }] }), /node\/…, way\/… or relation\/…/);
	assert.throws(
		() => read({ sources: [{ title: 'Komoot', url: 'http://www.komoot.com/tour/1', kind: 'mirror' }] }),
		/sources\[0\]\.url: a mirror needs an https URL/
	);
	assert.throws(
		() => read({ difficulty: { sections: [] } }),
		{ message: 'Hike facts in post.md: difficulty.sections moved into legs (inTable: false, onProfile: true); run scripts/crm/oneoff/merge-route-list.ts' }
	);
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
			{ kind: 'snowfield', at: { ref: 'node/2' }, severity: 'high' },
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
	// A remove that matches nothing warns.
	const none = read({ hazards: [{ kind: 'cold', remove: true }] }, { hazards: [{ kind: 'heat' }] });
	assert.deepEqual(none.facts!.hazards!.map((h) => h.kind), ['heat']);
	assert.match(none.warnings[0], /remove/);
});

test('hidden: true switches the whole layer off, sidecar included, unvalidated', () => {
	assert.deepEqual(read({ hidden: true, hazards: [{ kind: 'dragons' }] }, { summary: 'x' }), { facts: null, warnings: [] });
	assert.deepEqual(read({ hidden: false }, { summary: 'From the sidecar' }).facts!.summary, { en: 'From the sidecar' });
	assert.throws(() => read({ hidden: 'yes' }), /hidden: expected true or false/);
	// Only a post may hide the layer.
	assert.throws(() => read(undefined, { hidden: true }), /unknown key "hidden"/);
});

test('the overall SAC grade counts profile entries and non-optional legs; ranges rank by their upper end', () => {
	// The optional T5 leg doesn't count.
	const computed = read({ legs: [{ to: 'Knorrhütte', sac: 'T5', optional: true }, { to: 'Gipfel', sac: 'T3' }, band({ to: 'Gatterl', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T3+' })] });
	assert.equal(computed.facts!.difficulty!.sac, 'T3+');
	assert.equal(computed.facts!.difficulty!.sacSource, 'computed');
	// Of two equally hard grades the off-table entry's wins, as when sections came before the legs.
	assert.equal(read({ legs: [{ to: 'Gipfel', sac: 'T1-T3' }, band({ to: 'Gatterl', sac: 'T3' })] }).facts!.difficulty!.sac, 'T3');
	// An optional profile-only entry doesn't count either.
	assert.equal(read({ legs: [{ to: 'Gatterl', inTable: false, onProfile: true, sac: 'T4' }, { from: 'Gatterl', inTable: false, onProfile: true, sac: 'T6', optional: true }] }).facts!.difficulty!.sac, 'T4');
	// A range reads with an en dash and ranks as its upper end.
	const range = read({ legs: [band({ to: 'Gatterl', sac: 'T1-T2' }), band({ from: 'Gatterl', sac: 'T2' })] }).facts!;
	assert.equal(profileLegs(range)[0].sac, 'T1–T2');
	assert.equal(range.difficulty!.sac, 'T1–T2');
	assert.throws(() => read({ legs: [band({ sac: 'T3-T2' })] }), /SAC grade/);
	// A hand-written grade easier than the profile entries warns.
	const manual = read({ difficulty: { sac: 'T2' }, legs: [band({ sac: 'T4' })] });
	assert.equal(manual.facts!.difficulty!.sac, 'T2');
	assert.match(manual.warnings[0], /easier than/);
});

test('a bailout route is read from its GPX and summarised', () => {
	const r = read({ bailouts: [{ at: 'Knorrhütte', route: '/gpx/out.gpx' }] }).facts!.bailouts![0].route!;
	assert.equal(r.url, '/gpx/out.gpx');
	// The duplicate point is dropped; lon-before-lat attributes still parse.
	assert.equal(r.coords.length, 3);
	assert.deepEqual(r.coords[1], [47.02, 11.01]);
	assert.ok(Math.abs(r.distance - 1870) < 20);
	assert.equal(r.ascent, 0);
	assert.equal(r.descent, 200);
	assert.ok(r.duration! > 0);
	assert.throws(() => read({ bailouts: [{ at: 'Knorrhütte', route: '/gpx/missing.gpx' }] }), /no GPX file at "\/gpx\/missing\.gpx"/);
	assert.throws(() => read({ bailouts: [{ at: 'Knorrhütte', route: '/../secret.gpx' }] }), /served GPX path/);
	// Without track points, route points are read.
	const pts = parseGpxPoints('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"><ele>5</ele></rtept></rte></gpx>');
	assert.deepEqual(pts, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4, ele: 5 }]);
});

test('stops take OSM contact details, from the hike or the store, as safe links', () => {
	const { facts } = read({ stops: [{ at: 'Knorrhütte' }, { at: 'Gatterl', phone: '+43 2' }] });
	assert.equal(facts!.stops![0].phone, '+49 1');
	assert.deepEqual(facts!.stops![0].booking, { url: 'https://hut.example' });
	assert.equal(facts!.stops![1].phone, '+43 2');
	assert.equal(facts!.stops![1].booking, undefined);
	// A store node outside the hike, with contact:* tags.
	const far = { ref: 'node/9', lat: 47.3, lon: 11.2, tags: { name: 'Fernhütte', 'contact:phone': '+49 9', 'contact:website': 'https://far.example' } };
	const [s] = readWithStore({ stops: [{ at: 'Fernhütte' }] }, [...NODES, far]).facts!.stops!;
	assert.equal(s.phone, '+49 9');
	assert.deepEqual(s.booking, { url: 'https://far.example' });
	// An OSM website can't pick a script scheme.
	const booking = (website: string) => readWithStore({ stops: [{ at: 'Fernhütte' }] }, [...NODES, { ...far, tags: { name: 'Fernhütte', website } }]).facts!.stops![0].booking;
	assert.deepEqual(booking('javascript:alert(1)'), { url: 'https://javascript:alert(1)' });
	assert.deepEqual(booking('www.fern.example'), { url: 'https://www.fern.example' });
});

test("a ref outside the hike's nodes resolves from the store, and warns naming what it checked", () => {
	const hut = { ref: 'node/9', lat: 47.03, lon: 11.0, tags: { name: 'Fernhütte', ele: '1300' } };
	const { facts, warnings } = readWithStore({ hazards: [{ kind: 'cattle', at: { ref: 'node/9' } }] }, [...NODES, hut]);
	const at = facts!.hazards![0].at!;
	assert.deepEqual([at.name.en, at.ref, at.lat, at.lon, at.resolved], ['Fernhütte', 'node/9', 47.03, 11.0, true]);
	assert.deepEqual(warnings, []);
	assert.match(readWithStore({ hazards: [{ kind: 'cattle', at: { ref: 'node/99' } }] }, NODES).warnings[0], /is not in the OSM store/);
	// Without a store only the hike's nodes count.
	assert.match(read({ hazards: [{ kind: 'cattle', at: { ref: 'node/99' } }] }).warnings[0], /is not one of the hike's nodes/);
});

test('every enum value has an English label in en.json', () => {
	const facts = EN_TABLE.facts as { labels: Record<string, string>; enums: Record<string, Record<string, string>> };
	for (const [group, values] of Object.entries(ENUMS)) {
		for (const value of values) assert.ok(facts.enums[group]?.[String(value)], `${group}.${value}`);
	}
	for (const [key, text] of Object.entries(facts.labels)) assert.ok(text, `labels.${key}`);
});

test('FACTS_STRINGS values equal the JSON', () => {
	assert.deepEqual(FACTS_STRINGS.en, EN_TABLE.facts);
	// German is complete today, so its view is its own table; a gap would show the English.
	assert.deepEqual(FACTS_STRINGS.de, DE_TABLE.facts);
	for (const lang of LANGS) {
		const { labels } = FACTS_STRINGS[lang] as { labels: Record<string, string> };
		for (const key of Object.keys(labels)) assert.equal(labels[key], t(lang, `facts.labels.${key}`), `${lang}: ${key}`);
	}
});

test('legs split into table rows and profile entries, table rows chaining from the previous one', () => {
	const { facts } = read({
		legs: [
			{ to: 'Knorrhütte', sac: 'T2' }, { to: 'Gipfel', sac: 'T3', optional: true },
			band({ to: 'Gatterl', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T4+' })
		]
	});
	assert.deepEqual(facts!.legs!.map((l) => [l.inTable, l.onProfile]), [[true, false], [true, false], [false, true], [false, true]]);
	assert.deepEqual(tableLegs(facts!).map((l) => [l.from?.name.en, l.to!.name.en]), [[undefined, 'Knorrhütte'], ['Knorrhütte', 'Gipfel']]);
	assert.deepEqual(profileLegs(facts!).map((l) => [l.from?.name.en, l.to?.name.en, l.sac]), [[undefined, 'Gatterl', 'T2'], ['Gatterl', undefined, 'T4+']]);
	// Malformed entries.
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel', inTable: false }] }), /post\.md: legs\[0\]: .*onProfile/);
	assert.throws(() => read({ legs: [{ sac: 'T2' }] }), /post\.md: legs\[0\]\.to: required/);
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel' }] }), /post\.md: legs\[0\]\.from: /);
	// A post's entry checked in the merged list names the merged index, and says so.
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel' }] }, { legs: [{ to: 'Gatterl' }] }), /post\.md: legs\[1\]\.from \(after merging with the sidecar\): /);
});

test('a post leg merges only into a sidecar leg of the same kind and span', () => {
	const sidecar = { legs: [{ to: 'Knorrhütte', sac: 'T1' }, { to: 'Gatterl', sac: 'T2', marking: 'good' }, band({ from: 'Knorrhütte', to: 'Gatterl', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T3' })] };
	const row = (l: { from?: { name: { en?: string } }; to?: { name: { en?: string } }; sac?: string; marking?: string; inTable?: boolean }) =>
		[l.from?.name.en, l.to?.name.en, l.sac, l.marking, l.inTable];
	// Table leg into table leg by `to`; profile entry into profile entry by from/to; remove by span too.
	const { facts, warnings } = read({
		legs: [
			{ to: 'Gatterl', marking: 'poor' },
			band({ from: 'Gatterl', sac: 'T4', note: 'Icy' }),
			{ from: 'Knorrhütte', to: 'Gatterl', inTable: false, remove: true }
		]
	}, sidecar);
	assert.deepEqual(warnings, []);
	assert.deepEqual(facts!.legs!.map(row), [
		[undefined, 'Knorrhütte', 'T1', undefined, true],
		['Knorrhütte', 'Gatterl', 'T2', 'poor', true],
		['Gatterl', undefined, 'T4', undefined, false]
	]);
	assert.deepEqual(profileLegs(facts!)[0].note, { en: 'Icy' });
	// A profile entry from the start to X is not the table leg to X.
	const apart = read({ legs: [band({ to: 'Gatterl', sac: 'T4' })] }, { legs: [{ to: 'Gatterl', sac: 'T2', marking: 'good' }] }).facts!;
	assert.deepEqual(apart.legs!.map(row), [[undefined, 'Gatterl', 'T2', 'good', true], [undefined, 'Gatterl', 'T4', undefined, false]]);
	assert.equal(read({ legs: [{ to: 'Gatterl' }, { to: 'Gatterl', inTable: false, onProfile: true }] }).facts!.legs!.length, 2);
});

test('a span ends at the pass that keeps it in route order', () => {
	// A lollipop: up to the junction, a loop over the top and back down another way to the junction, out the way it came.
	const coords = [[11.0, 47.0, 1000], [11.0, 47.02, 1200], [11.0, 47.04, 1400], [11.01, 47.03, 1300], [11.0, 47.02, 1200], [11.0, 47.0, 1000]];
	const nodes = [
		{ ref: 'node/1', lat: 47.02, lon: 11.0, tags: { name: 'Junction' } },
		{ ref: 'node/2', lat: 47.04, lon: 11.0, tags: { name: 'Top' } }
	];
	const { facts } = readHikeFacts({
		sidecar: {
			hazards: [
				{ kind: 'fall-risk', from: { lat: 47.03, lon: 11.01, name: 'On the way down' }, to: { ref: 'node/1' } },
				{ kind: 'rockfall', from: { ref: 'node/1' }, to: { ref: 'node/2' } }
			],
			legs: [{ to: { ref: 'node/1' } }, { to: { ref: 'node/2' } }, { to: { ref: 'node/1' } }]
		},
		post: undefined, postSource: 'post.md', sidecarSource: 'side.hike.json', nodes, coords, distanceFactor: 1
	});
	const junction = facts!.hazards![0].to!;
	assert.equal(junction.passes!.length, 2, 'the junction is passed twice');
	const [first, second] = junction.passes!;
	const down = facts!.hazards![0].from!.km!;
	assert.ok(down > first && down < second);
	assert.equal(junction.km, second, 'from the way down to the junction: its second pass, not its first');
	assert.equal(facts!.hazards![1].from!.km, first, 'from the junction up to the top: its first pass');
	const legs = facts!.legs!;
	assert.deepEqual(legs.map((l) => l.to!.km), [first, legs[1].to!.km, second], 'the route list runs forward');
	assert.equal(legs[2].from, legs[1].to);
	const overlay = buildFactsOverlay(facts, 'en', coords, 1);
	const band = overlay.bands.find((b) => b.row === 1 && b.title.startsWith('Fall'))!;
	assert.deepEqual([band.from, band.to], [down, second]);
});

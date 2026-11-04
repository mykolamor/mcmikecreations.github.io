// Run with: node_modules/.bin/jiti src/lib/hikes/facts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpxPoints, readHikeFacts, summariseGpxRoute, validateText, type ReadFactsInput } from './facts.server';
import { ENUMS, LANGS, profileLegs, sacRank, tableLegs } from './facts-schema';
import { LANGS as LANGUAGE_LIST } from '../i18n/languages';
import { FACTS_STRINGS, factsStrings } from './facts-strings';
import { enumLabel, formatGrades, mirrorPlatform } from './facts-format';
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

/** An old `difficulty.sections` entry as it reads in the route list: a profile-only entry. */
const band = (s: Record<string, unknown>) => ({ ...s, inTable: false, onProfile: true });

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
	assert.equal(facts!.bailouts![0].at.ref, 'node/1');
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
	assert.equal(facts!.route!.end!.ref, 'node/3');
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

test('readText rejects a language not in LANGS, listing the allowed ones', () => {
	// The schema re-exports the one language list rather than keeping its own.
	assert.equal(LANGS, LANGUAGE_LIST);
	assert.throws(
		() => read({ summary: { en: 'x', fr: 'y' } }),
		new RegExp(`summary: unknown language "fr" \\(${LANGS.join(', ')}\\)`)
	);
	assert.throws(() => read({ summary: { en: 'x', fr: 'y' } }), /unknown language "fr" \(en, de\)/);
});

test('readText keeps every listed language', () => {
	const summary = Object.fromEntries(LANGS.map((lang) => [lang, ` Text ${lang} `]));
	const { facts } = read({ summary });
	assert.deepEqual(facts!.summary, Object.fromEntries(LANGS.map((lang) => [lang, `Text ${lang}`])));
	for (const lang of LANGS.slice(1)) {
		assert.throws(() => read({ summary: { en: 'x', [lang]: ' ' } }), new RegExp(`summary\\.${lang}: expected text`));
	}
	// A post may carry only a translation; it merges over the sidecar's English.
	const only = Object.fromEntries(LANGS.slice(1).map((lang) => [lang, `Nur ${lang}`]));
	assert.deepEqual(read({ summary: only }, { summary: 'Route' }).facts!.summary, { en: 'Route', ...only });
});

test('adding a language to LANGS is the only change needed', () => {
	const langs = ['en', 'de', 'uk'];
	assert.deepEqual(validateText({ en: 'Hut', uk: ' Хатина ' }, 'name', 'side.hike.json', { langs }), { en: 'Hut', uk: 'Хатина' });
	assert.deepEqual(validateText({ uk: 'Хатина' }, 'name', 'post.md', { langs, post: true }), { uk: 'Хатина' });
	assert.throws(() => validateText({ en: 'Hut', uk: 'Хатина' }, 'name', 'side.hike.json'), /name: unknown language "uk" \(en, de\)/);
	assert.throws(() => validateText({ en: 'Hut', cs: 'Chata' }, 'name', 'side.hike.json', { langs }), /unknown language "cs" \(en, de, uk\)/);
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
});

test('remove that matches nothing warns', () => {
	const { facts, warnings } = read({ hazards: [{ kind: 'cold', remove: true }] }, { hazards: [{ kind: 'heat' }] });
	assert.deepEqual(facts!.hazards!.map((h) => h.kind), ['heat']);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /remove/);
});

test('the overall SAC grade is computed from profile entries and non-optional legs', () => {
	const { facts } = read({
		legs: [{ to: 'Knorrhütte', sac: 'T5', optional: true }, { to: 'Gipfel', sac: 'T3' }, band({ to: 'Gatterl', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T3+' })]
	});
	assert.equal(facts!.difficulty!.sac, 'T3+');
	assert.equal(facts!.difficulty!.sacSource, 'computed');
});

test('a hand-written SAC easier than the profile entries warns', () => {
	const { facts, warnings } = read({ difficulty: { sac: 'T2' }, legs: [band({ sac: 'T4' })] });
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

test('hub taxonomy: regions and categories are enums, countries ISO codes, huts places; a post list replaces', () => {
	const side = { route: { regions: ['wetterstein', 'ehrwald'], categories: ['summit'], countries: ['AT', 'DE'], huts: ['Knorrhütte'] } };
	const { facts } = read({ route: { categories: ['via-ferrata'] } }, side);
	assert.deepEqual(facts!.route!.regions, ['wetterstein', 'ehrwald']);
	assert.deepEqual(facts!.route!.categories, ['via-ferrata']);
	assert.deepEqual(facts!.route!.countries, ['AT', 'DE']);
	assert.equal(facts!.route!.huts![0].ref, 'node/1');
	assert.throws(() => read({ route: { regions: ['atlantis'] } }), /route\.regions\[0\].*unknown value/);
	assert.throws(() => read({ route: { countries: ['de'] } }), /route\.countries\[0\].*ISO/);
	assert.throws(() => read({ route: { countries: ['XX'] } }), /route\.countries\[0\].*ISO/);
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

test('SAC ranges rank as their upper end and read with an en dash', () => {
	assert.equal(sacRank('T1-T2'), sacRank('T2'));
	assert.ok(sacRank('T2–T3+') > sacRank('T3'));
	const { facts } = read({ legs: [band({ to: 'Gatterl', sac: 'T1-T2' }), band({ from: 'Gatterl', sac: 'T2' })] });
	assert.equal(profileLegs(facts!)[0].sac, 'T1–T2');
	assert.equal(facts!.difficulty!.sac, 'T1–T2');
	assert.throws(() => read({ legs: [band({ sac: 'T3-T2' })] }), /SAC grade/);
	assert.throws(() => read({ legs: [band({ sac: 'T2-T2' })] }), /SAC grade/);
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

test('FACTS_STRINGS has every language in LANGS, each falling back to the English', () => {
	assert.deepEqual(Object.keys(FACTS_STRINGS), [...LANGUAGE_LIST]);
	const view = factsStrings({ en: EN_TABLE, uk: { facts: { labels: { season: 'Сезон' } } } });
	assert.deepEqual(Object.keys(view), ['en', 'uk']);
	assert.equal((view.uk.labels as Record<string, string>).season, 'Сезон');
	assert.deepEqual({ ...view.uk.labels, season: EN_TABLE.facts.labels.season }, EN_TABLE.facts.labels);
	assert.deepEqual(view.uk.enums, EN_TABLE.facts.enums);
});

test('a mirror source needs an https URL', () => {
	const ok = read({ sources: [{ title: 'Komoot', url: 'https://www.komoot.com/tour/1', kind: 'mirror' }] });
	assert.equal(ok.facts!.sources![0].kind, 'mirror');
	assert.throws(
		() => read({ sources: [{ title: 'Komoot', url: 'http://www.komoot.com/tour/1', kind: 'mirror' }] }),
		/sources\[0\]\.url: a mirror needs an https URL/
	);
	// Other kinds keep accepting plain http.
	assert.doesNotThrow(() => read({ sources: [{ title: 'Hut', url: 'http://hut.example', kind: 'official' }] }));
});

test('mirror platforms come from the URL host', () => {
	assert.equal(mirrorPlatform('https://www.komoot.com/tour/3342722659'), 'Komoot');
	assert.equal(mirrorPlatform('https://komoot.de/tour/1'), 'Komoot');
	assert.equal(mirrorPlatform('https://www.strava.com/activities/1'), 'Strava');
	assert.equal(mirrorPlatform('https://example.org/route'), undefined);
	assert.equal(mirrorPlatform('not a url'), undefined);
});

test('post sources merge into the sidecar sources by url', () => {
	const { facts } = read(
		{
			sources: [
				{ title: 'Strava', url: 'https://www.strava.com/activities/1', kind: 'mirror' },
				{ title: 'Hut', url: 'https://hut.example', note: 'Closed Mondays.' }
			]
		},
		{
			sources: [
				{ title: 'Hut', url: 'https://hut.example', kind: 'official' },
				{ title: 'Guide', url: 'https://guide.example', kind: 'guidebook' }
			]
		}
	);
	assert.deepEqual(
		facts!.sources!.map((s) => s.url),
		['https://hut.example', 'https://guide.example', 'https://www.strava.com/activities/1']
	);
	// A matching url merges field by field instead of replacing the sidecar's entry.
	assert.equal(facts!.sources![0].kind, 'official');
	assert.deepEqual(facts!.sources![0].note, { en: 'Closed Mondays.' });
});

test('a place names an OSM element by typed ref; the old numeric form fails', () => {
	const { facts } = read({ hazards: [{ kind: 'cattle', at: { ref: 'node/2', name: 'Gate' } }] });
	assert.equal(facts!.hazards![0].at!.ref, 'node/2');
	assert.equal(facts!.hazards![0].at!.name.en, 'Gate');
	assert.throws(() => read({ hazards: [{ kind: 'cattle', at: { node: 2 } }] }), /ref/);
	assert.throws(() => read({ hazards: [{ kind: 'cattle', at: { ref: 'peak/2' } }] }), /node\/…, way\/… or relation\/…/);
});

test('a stop matched to a store node outside the hike takes its OSM contact details', () => {
	const hut = { ref: 'node/9', lat: 47.3, lon: 11.2, tags: { name: 'Fernhütte', 'contact:phone': '+49 9', 'contact:website': 'https://far.example' } };
	const input: ReadFactsInput = {
		post: { stops: [{ at: 'Fernhütte' }] }, sidecar: undefined,
		postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, storeNodes: [...NODES, hut], coords: COORDS, distanceFactor: 1
	};
	const { facts } = readHikeFacts(input);
	for (const s of facts!.stops!) {
		assert.equal(s.phone, '+49 9');
		assert.deepEqual(s.booking, { url: 'https://far.example' });
	}
});

test("a stop's OSM website becomes a safe booking link", () => {
	const hut = (website: string) => ({ ref: 'node/9', lat: 47.3, lon: 11.2, tags: { name: 'Fernhütte', website } });
	const booking = (website: string) => readHikeFacts({
		post: { stops: [{ at: 'Fernhütte' }] }, sidecar: undefined,
		postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, storeNodes: [...NODES, hut(website)], coords: COORDS, distanceFactor: 1
	}).facts!.stops![0].booking;
	assert.deepEqual(booking('javascript:alert(1)'), { url: 'https://javascript:alert(1)' });
	assert.deepEqual(booking('www.fern.example'), { url: 'https://www.fern.example' });
	assert.deepEqual(booking('http://fern.example'), { url: 'http://fern.example' });
});

test("a ref outside the hike's nodes resolves from the store", () => {
	const hut = { ref: 'node/9', lat: 47.03, lon: 11.0, tags: { name: 'Fernhütte', ele: '1300' } };
	const { facts, warnings } = readHikeFacts({
		post: { hazards: [{ kind: 'cattle', at: { ref: 'node/9' } }] }, sidecar: undefined,
		postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, storeNodes: [...NODES, hut], coords: COORDS, distanceFactor: 1
	});
	const at = facts!.hazards![0].at!;
	assert.equal(at.name.en, 'Fernhütte');
	assert.equal(at.ref, 'node/9');
	assert.equal(at.lat, 47.03);
	assert.equal(at.lon, 11.0);
	assert.equal(at.resolved, true);
	assert.deepEqual(warnings, []);
});

test('a ref missing from the store warns naming the store', () => {
	const { warnings } = readHikeFacts({
		post: { hazards: [{ kind: 'cattle', at: { ref: 'node/99' } }] }, sidecar: undefined,
		postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, storeNodes: NODES, coords: COORDS, distanceFactor: 1
	});
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /is not in the OSM store/);
});

test('without a store a ref still resolves only against nodes', () => {
	const { warnings } = read({ hazards: [{ kind: 'cattle', at: { ref: 'node/99' } }] });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /is not one of the hike's nodes/);
	assert.deepEqual(read({ hazards: [{ kind: 'cattle', at: { ref: 'node/2' } }] }).warnings, []);
});

// The route list: legs (table rows) and the old difficulty.sections (profile bands) in one `legs`.
const ROUTE_LIST = {
	legs: [
		{ to: 'Knorrhütte', sac: 'T2', terrain: ['forest', 'path'], marking: 'good' }, { to: 'Gipfel', sac: 'T3', optional: true, note: 'Scramble' },
		band({ to: 'Gatterl', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T4+', viaFerrata: { grade: 'B' }, note: 'Ridge' })
	]
};

test('legs and profile entries render as before through tableLegs and profileLegs', () => {
	const { facts } = read(ROUTE_LIST);
	// What the leg table, the profile bands and the Sections list showed before the one list.
	assert.deepEqual(
		tableLegs(facts!).map((l) => [l.to!.name.en, (l.terrain ?? []).map((x) => enumLabel('en', 'terrain', x)).join(', '), formatGrades('en', l), l.marking ?? '', !!l.optional, l.note?.en ?? '']),
		[['Knorrhütte', 'forest, path', 'T2', 'good', false, ''], ['Gipfel', '', 'T3', '', true, 'Scramble']]
	);
	assert.deepEqual(
		buildFactsOverlay(facts, 'en', COORDS, 1).bands.map((b) => [b.from, b.to, b.color, b.text, b.title]),
		[[0, 5.559746332227622, '#f87171', 'T2', 'T2 Gatterl'], [5.559746332227622, 11.119492664456034, '#3b82f6', 'T4+ · B', 'T4+ · B Gatterl: Ridge']]
	);
	assert.deepEqual(
		profileLegs(facts!).map((s) => [formatGrades('en', s), s.from?.name.en, s.to?.name.en, s.note?.en]),
		[['T2', undefined, 'Gatterl', undefined], ['T4+ · B', 'Gatterl', undefined, 'Ridge']]
	);
	// Defaults filled in, and a table entry starts where the previous one ended.
	assert.deepEqual(facts!.legs!.map((l) => [l.inTable, l.onProfile]), [[true, false], [true, false], [false, true], [false, true]]);
	assert.equal(tableLegs(facts!)[0].from, undefined);
	assert.equal(tableLegs(facts!)[1].from!.name.en, 'Knorrhütte');
});

test('a profile-only entry without onProfile fails', () => {
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel', inTable: false }] }), /post\.md: legs\[0\]: .*onProfile/);
	assert.doesNotThrow(() => read({ legs: [{ from: 'Gatterl', inTable: false, onProfile: true }] }));
});

test('a table entry with its own from fails', () => {
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel' }] }), /post\.md: legs\[0\]\.from: /);
	assert.throws(() => read(undefined, { legs: [{ to: 'Gatterl' }, { from: 'Gatterl', to: 'Gipfel', onProfile: true }] }), /side\.hike\.json: legs\[1\]\.from: /);
	// A post's entry checked in the merged list names the merged index, and says so.
	assert.throws(() => read({ legs: [{ from: 'Gatterl', to: 'Gipfel' }] }, { legs: [{ to: 'Gatterl' }] }), /post\.md: legs\[1\]\.from \(after merging with the sidecar\): /);
});

test('a table entry without to fails', () => {
	assert.throws(() => read({ legs: [{ sac: 'T2' }] }), /post\.md: legs\[0\]\.to: required/);
	assert.throws(() => read({ legs: [{ sac: 'T2', inTable: true, onProfile: true }] }), /legs\[0\]\.to: required/);
});

test('the overall grade counts profile entries and non-optional legs as before', () => {
	// The optional T5 leg doesn't count; the T4+ profile entry does.
	assert.equal(read(ROUTE_LIST).facts!.difficulty!.sac, 'T4+');
	const { facts } = read({
		legs: [{ to: 'Knorrhütte', sac: 'T5', optional: true }, { to: 'Gipfel', sac: 'T3' }, band({ to: 'Gatterl', sac: 'T2' })]
	});
	assert.equal(facts!.difficulty!.sac, 'T3');
	assert.equal(facts!.difficulty!.sacSource, 'computed');
	// Of two equally hard grades the off-table entry's wins, as when sections came before the legs.
	assert.equal(read({ legs: [{ to: 'Gipfel', sac: 'T1-T3' }, band({ to: 'Gatterl', sac: 'T3' })] }).facts!.difficulty!.sac, 'T3');
	// A profile-only entry counts too, and an optional one doesn't.
	assert.equal(read({ legs: [{ to: 'Gatterl', inTable: false, onProfile: true, sac: 'T4' }, { from: 'Gatterl', inTable: false, onProfile: true, sac: 'T6', optional: true }] }).facts!.difficulty!.sac, 'T4');
});

test('a post profile entry still merges by from/to', () => {
	const sidecar = { legs: [{ to: 'Gatterl', sac: 'T2' }, band({ to: 'Gatterl', from: 'Knorrhütte', sac: 'T2' }), band({ from: 'Gatterl', sac: 'T3' })] };
	const post = { legs: [band({ from: 'Gatterl', sac: 'T4', note: 'Icy' }), { from: 'Knorrhütte', to: 'Gatterl', inTable: false, remove: true }] };
	const { facts, warnings } = read(post, sidecar);
	assert.deepEqual(warnings, []);
	assert.deepEqual(facts!.legs!.map((l) => [l.from?.name.en, l.to?.name.en, l.sac, l.inTable, l.onProfile]), [
		[undefined, 'Gatterl', 'T2', true, false],
		['Gatterl', undefined, 'T4', false, true]
	]);
	assert.deepEqual(profileLegs(facts!)[0].note, { en: 'Icy' });
	// A post leg still merges into the sidecar leg by its `to`.
	assert.deepEqual(read({ legs: [{ to: 'Gatterl', marking: 'poor' }] }, sidecar).facts!.legs![0].marking, 'poor');
});

test('a post profile entry from the start to X does not merge into the sidecar\'s table leg to X', () => {
	const { facts } = read({ legs: [band({ to: 'Gatterl', sac: 'T4' })] }, { legs: [{ to: 'Gatterl', sac: 'T2', marking: 'good' }] });
	assert.deepEqual(facts!.legs!.map((l) => [l.from?.name.en, l.to?.name.en, l.sac, l.marking, l.inTable, l.onProfile]), [
		[undefined, 'Gatterl', 'T2', 'good', true, false],
		[undefined, 'Gatterl', 'T4', undefined, false, true]
	]);
	// Nor does a profile-only entry of the same span in the post's own list.
	assert.equal(read({ legs: [{ to: 'Gatterl' }, { to: 'Gatterl', inTable: false, onProfile: true }] }).facts!.legs!.length, 2);
});

test('a post table leg to X still merges with the sidecar\'s table leg to X', () => {
	const sidecar = { legs: [{ to: 'Knorrhütte', sac: 'T1' }, { to: 'Gatterl', sac: 'T2', marking: 'good' }] };
	const { facts } = read({ legs: [{ to: 'Gatterl', marking: 'poor', onProfile: true }] }, sidecar);
	assert.deepEqual(facts!.legs!.map((l) => [l.from?.name.en, l.to?.name.en, l.sac, l.marking, l.inTable, l.onProfile]), [
		[undefined, 'Knorrhütte', 'T1', undefined, true, false],
		['Knorrhütte', 'Gatterl', 'T2', 'poor', true, true]
	]);
	assert.deepEqual(read({ legs: [{ to: 'Gatterl', remove: true }] }, sidecar).facts!.legs!.map((l) => l.to!.name.en), ['Knorrhütte']);
});

test('a post profile entry with the same from/to as a sidecar profile entry still merges', () => {
	const sidecar = { legs: [{ to: 'Gipfel' }, band({ from: 'Knorrhütte', to: 'Gatterl', sac: 'T2' })] };
	const { facts } = read({ legs: [band({ from: 'Knorrhütte', to: 'Gatterl', sac: 'T3', note: 'Wet' })] }, sidecar);
	assert.deepEqual(profileLegs(facts!).map((l) => [l.from?.name.en, l.to?.name.en, l.sac, l.note?.en]), [['Knorrhütte', 'Gatterl', 'T3', 'Wet']]);
	assert.equal(facts!.legs!.length, 2);
});

test('difficulty.sections after the migration fails with a hint to use legs', () => {
	const hint = 'difficulty.sections moved into legs (inTable: false, onProfile: true); run scripts/crm/oneoff/merge-route-list.ts';
	const old = { difficulty: { sections: [{ to: 'Gatterl', sac: 'T2' }] } };
	assert.throws(() => read(undefined, old), { message: `Hike facts in side.hike.json: ${hint}` });
	assert.throws(() => read(old), { message: `Hike facts in post.md: ${hint}` });
	// Even emptied or removed, the key is the old one.
	assert.throws(() => read({ difficulty: { sac: 'T2', sections: [] } }), { message: `Hike facts in post.md: ${hint}` });
	assert.throws(() => read({ difficulty: { sections: null } }), { message: `Hike facts in post.md: ${hint}` });
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

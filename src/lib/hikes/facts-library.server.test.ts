// Run with: node_modules/.bin/jiti src/lib/hikes/facts-library.server.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHikeFacts, type ReadFactsInput } from './facts.server';
import { emptyFactsLibrary, readFactsLibrary, type FactsLibrary } from './facts-library.server';

// A straight route north along lon 11.0, as in facts.test.ts.
const COORDS = Array.from({ length: 11 }, (_, i) => [11.0, 47.0 + i * 0.01, 1000 + i * 100]);
const NODES = [
	{ ref: 'node/1', lat: 47.02, lon: 11.0, tags: { name: 'Knorrhütte', ele: '1200', phone: '+49 1', website: 'hut.example' } },
	{ ref: 'node/2', lat: 47.05, lon: 11.0, tags: { name: 'Gatterl', ele: '1500' } }
];

const TRAIN = {
	mode: 'train', from: 'München Hbf', to: 'Gatterl', direction: 'both', duration: 120, line: 'RB60',
	price: [{ amount: 29, currency: 'EUR', per: 'person' }], note: { en: 'Change in Garmisch', de: 'Umstieg in Garmisch' },
	checked: '2026-07-01'
};

const LIBRARY = (): FactsLibrary => readFactsLibrary({
	stops: { 'node/1': { kind: 'alpine-hut', overnight: true, note: 'Book ahead', checked: '2026-06-01' } },
	transport: { 'rb60-munich': TRAIN },
	lifts: {},
	parking: {},
	tickets: {}
}, 'facts-library.json');

function read(post: unknown, sidecar: unknown = undefined, library: FactsLibrary | undefined = LIBRARY()) {
	const input: ReadFactsInput = {
		post, sidecar, postSource: 'post.md', sidecarSource: 'side.hike.json',
		nodes: NODES, coords: COORDS, distanceFactor: 1, library
	};
	return readHikeFacts(input);
}

test('a used transport record renders as if written inline', () => {
	const inline = read({ access: { transport: [TRAIN] } });
	const used = read({ access: { transport: [{ use: 'rb60-munich' }] } });
	assert.deepEqual(used.warnings, []);
	assert.deepEqual(used.facts, inline.facts);
	// Through the sidecar too, and with no library at all an inline entry reads as before.
	assert.deepEqual(read(undefined, { access: { transport: [{ use: 'rb60-munich' }] } }).facts, inline.facts);
	assert.deepEqual(read({ access: { transport: [TRAIN] } }, undefined, undefined).facts, inline.facts);
});

test('a post field overrides one field of a used record and keeps the rest', () => {
	const sidecar = { access: { transport: [{ use: 'rb60-munich', line: 'RB 60' }] } };
	const { facts } = read({ access: { transport: [{ use: 'rb60-munich', duration: 95, note: { de: 'Direkt' } }] } }, sidecar);
	const [t] = facts!.access!.transport!;
	assert.equal(facts!.access!.transport!.length, 1, 'the post entry merges into the sidecar one');
	assert.equal(t.duration, 95, 'the post wins');
	assert.equal(t.line, 'RB 60', 'the sidecar wins over the record');
	assert.deepEqual(t.note, { en: 'Change in Garmisch', de: 'Direkt' }, 'a text merges per language');
	assert.equal(t.mode, 'train');
	assert.deepEqual(t.from, { en: 'München Hbf' });
	assert.equal(t.to.ref, 'node/2');
	assert.deepEqual(t.price, [{ amount: 29, currency: 'EUR', per: 'person' }]);
	assert.equal(t.checked, '2026-07-01');
	assert.ok(!('use' in t), 'the reference itself is not page data');
	// A post's null removes one of the record's fields.
	const dropped = read({ access: { transport: [{ use: 'rb60-munich', price: null }] } }).facts!.access!.transport![0];
	assert.equal(dropped.price, undefined);
	assert.equal(dropped.line, 'RB60');
	// The same with the sidecar using the record too: the post's null still reaches the record.
	const both = read(
		{ access: { transport: [{ use: 'rb60-munich', price: null }] } },
		{ access: { transport: [{ use: 'rb60-munich', line: 'RB 60' }] } }
	).facts!.access!.transport![0];
	assert.ok(!('price' in both), 'the record\'s price is removed');
	assert.equal(both.line, 'RB 60');
	assert.equal(both.duration, 120);
	assert.deepEqual(Object.getOwnPropertySymbols(both), []);
	for (const v of Object.values(both)) assert.notEqual(typeof v, 'symbol', 'no DELETE marker reaches the page');
});

test('a post null removes a field of an attached stop record under a sidecar stop', () => {
	const { facts, warnings } = read({ stops: [{ at: 'Knorrhütte', overnight: null }] }, { stops: [{ at: { ref: 'node/1' }, food: true }] });
	assert.deepEqual(warnings, []);
	const [s] = facts!.stops!;
	assert.ok(!('overnight' in s), 'the record\'s overnight is removed');
	assert.equal(s.food, true);
	assert.equal(s.kind, 'alpine-hut');
	assert.deepEqual(s.note, { en: 'Book ahead' });
	assert.deepEqual(Object.getOwnPropertySymbols(s), []);
	for (const v of Object.values(s)) assert.notEqual(typeof v, 'symbol', 'no DELETE marker reaches the page');
});

test('a problem inside a used record names the entry that uses it', () => {
	const lib = readFactsLibrary({
		transport: { bus: { mode: 'bus', from: 'Garmisch', to: { ref: 'node/99' } } },
		lifts: { up: { name: 'Up', from: 'Nowhere Pass' } }
	}, 'facts-library.json');
	const post = read({ access: { transport: [TRAIN, { use: 'bus' }] } }, undefined, lib);
	assert.equal(post.warnings.length, 1);
	assert.match(post.warnings[0], /^Hike facts in post\.md: access\.transport\[1\] \(use "bus"\): facts-library\.json: transport\.bus\.to: place "node\/99"/);
	const side = read(undefined, { access: { lifts: [{ use: 'up' }] } }, lib);
	assert.equal(side.warnings.length, 1);
	assert.match(side.warnings[0], /^Hike facts in side\.hike\.json: access\.lifts\[0\] \(use "up"\): facts-library\.json: lifts\.up\.from: place "Nowhere Pass"/);
});

test('a stop on an OSM element with a library record starts from it', () => {
	const { facts, warnings } = read({ stops: [{ at: 'Knorrhütte', note: 'Closed Mondays' }] }, { stops: [{ at: { ref: 'node/1' }, food: true }] });
	assert.deepEqual(warnings, []);
	assert.equal(facts!.stops!.length, 1);
	const [s] = facts!.stops!;
	assert.equal(s.at.ref, 'node/1');
	assert.equal(s.kind, 'alpine-hut');
	assert.equal(s.overnight, true);
	assert.equal(s.food, true);
	assert.deepEqual(s.note, { en: 'Closed Mondays' });
	assert.equal(s.checked, '2026-06-01');
	// A stop on an element without a record is left alone.
	assert.equal(read({ stops: [{ at: 'Gatterl' }] }).facts!.stops![0].kind, undefined);
});

test('OSM contact fallback still applies after the library', () => {
	const [s] = read({ stops: [{ at: { ref: 'node/1' } }] }).facts!.stops!;
	assert.equal(s.kind, 'alpine-hut');
	assert.equal(s.phone, '+49 1');
	assert.deepEqual(s.booking, { url: 'https://hut.example' });
	// A record's own contact details win over OSM's.
	const lib = readFactsLibrary({ stops: { 'node/1': { phone: '+49 2', booking: 'https://book.example' } } }, 'facts-library.json');
	const [own] = read({ stops: [{ at: 'Knorrhütte' }] }, undefined, lib).facts!.stops!;
	assert.equal(own.phone, '+49 2');
	assert.deepEqual(own.booking, { url: 'https://book.example' });
});

test('an unknown use id fails naming file, path and id', () => {
	assert.throws(
		() => read({ access: { transport: [TRAIN, { use: 'rb6-munich' }] } }),
		/post\.md: access\.transport\[1\]\.use: no transport record "rb6-munich" in facts-library\.json/
	);
	assert.throws(
		() => read(undefined, { access: { lifts: [{ use: 'gondola' }] } }, emptyFactsLibrary()),
		/side\.hike\.json: access\.lifts\[0\]\.use: no lift record "gondola" in facts-library\.json/
	);
	assert.throws(() => read({ access: { tickets: [{ use: ' ' }] } }), /access\.tickets\[0\]\.use: expected a string/);
	// The fields a record lacks are still required of the entry.
	const lib = readFactsLibrary({ transport: { bus: { mode: 'bus', line: '9' } } }, 'facts-library.json');
	assert.throws(() => read({ access: { transport: [{ use: 'bus' }] } }, undefined, lib), /access\.transport\[0\]\.from: required/);
	// Stops attach by place; they take no `use`.
	assert.throws(() => read({ stops: [{ at: 'Gatterl', use: 'node/1' }] }), /stops\[0\]: unknown key "use"/);
});

test('a malformed library record fails naming kind, id and path', () => {
	const bad = (raw: unknown) => () => readFactsLibrary(raw, 'facts-library.json');
	assert.throws(bad({ transport: { 'rb60': { ...TRAIN, price: [{ amount: 'x' }] } } }), /facts-library\.json: transport\.rb60\.price\[0\]\.amount: expected a number/);
	assert.throws(bad({ transport: { 'rb60': { mode: 'rocket' } } }), /facts-library\.json: transport\.rb60\.mode: unknown value "rocket"/);
	assert.throws(bad({ lifts: { gondola: { kind: 'gondola' } } }), /facts-library\.json: lifts\.gondola\.name: required/);
	assert.throws(bad({ stops: { 'node/1': { at: 'Knorrhütte' } } }), /facts-library\.json: stops\.node\/1: unknown key "at"/);
	assert.throws(bad({ parking: { p1: { use: 'p2' } } }), /facts-library\.json: parking\.p1: unknown key "use"/);
	assert.throws(bad({ stops: { hut: { kind: 'alpine-hut' } } }), /facts-library\.json: stops\.hut: expected a typed OSM ref/);
	assert.throws(bad({ tickets: { 'Bayern-Ticket': { name: 'Bayern-Ticket' } } }), /facts-library\.json: tickets\.Bayern-Ticket: expected an id/);
	assert.throws(bad({ huts: {} }), /facts-library\.json: huts: unknown record kind/);
	assert.throws(bad({ tickets: { day: 'Day ticket' } }), /facts-library\.json: tickets\.day: expected a mapping/);
	assert.deepEqual(readFactsLibrary({}, 'facts-library.json'), emptyFactsLibrary());
});

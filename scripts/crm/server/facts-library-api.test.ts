import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeTempRepo } from './test-repo';
import { createApi, type ApiRequest } from './api';
import { libraryUsage } from './facts-read';
import { libraryState, libraryVersion } from './facts-library-api';
import { libraryProblems } from './problems';
import { repoPaths } from './paths';

const FIRSTALM = 'way/60315210';
const put = (json: unknown): ApiRequest => ({ method: 'PUT', path: '/api/facts/library/record', query: new URLSearchParams(), headers: {}, json });
const libraryBytes = (root: string) => readFileSync(repoPaths(root).factsLibrary, 'utf8');

test('usage lists the hikes that take a record', () => {
	const root = makeTempRepo();
	const usage = libraryUsage(root);
	assert.deepEqual(usage[`stops/${FIRSTALM}`], ['2026-09-20-duernbachwand', '2026-10-22-krettenburg_westerberg']);
	// A record no hike takes is listed with none.
	const lib = JSON.parse(libraryBytes(root));
	lib.tickets['day-pass'] = { name: 'Day pass' };
	writeFileSync(repoPaths(root).factsLibrary, JSON.stringify(lib));
	assert.deepEqual(libraryUsage(root)['tickets/day-pass'], []);
	// The library check still reads the same: the unused record warned about, nothing else.
	assert.deepEqual(libraryProblems(root).map((p) => p.message), ['ticket "day-pass" is used by no hike']);
});

test('GET /api/facts/library answers the version, the library and its usage', async () => {
	const root = makeTempRepo();
	const r = await createApi(root)({ method: 'GET', path: '/api/facts/library', query: new URLSearchParams(), headers: {} });
	assert.equal(r.status, 200);
	assert.deepEqual(r.json, libraryState(root));
	const json = r.json as ReturnType<typeof libraryState>;
	assert.equal(json.version, libraryVersion(root));
	assert.match(json.version, /^[0-9a-f]{40}$/);
	assert.equal((json.library.stops[FIRSTALM] as Record<string, unknown>).kind, 'restaurant');
	assert.equal(json.usage[`stops/${FIRSTALM}`].length, 2);
});

test('a record is written byte-stably and answers the new state', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const before = libraryBytes(root);
	const r = await api(put({ kind: 'tickets', id: 'day-pass', record: { name: { en: 'Day pass', de: 'Tageskarte' } }, base: libraryVersion(root) }));
	assert.equal(r.status, 200);
	const after = libraryBytes(root);
	assert.match(after, /"tickets": \{\n\t\t"day-pass": \{\n\t\t\t"name": \{\n\t\t\t\t"en": "Day pass",\n\t\t\t\t"de": "Tageskarte"\n\t\t\t\}\n\t\t\}\n\t\}/);
	// The stop record's bytes stay.
	assert.equal(after.slice(0, after.indexOf('"transport"')), before.slice(0, before.indexOf('"transport"')));
	assert.equal((r.json as ReturnType<typeof libraryState>).version, libraryVersion(root));
	assert.deepEqual((r.json as ReturnType<typeof libraryState>).usage['tickets/day-pass'], []);
	// The site's check: a malformed record or id is its message, and nothing is written.
	const bad = await api(put({ kind: 'tickets', id: 'day-pass', record: { price: 5 }, base: libraryVersion(root) }));
	assert.equal(bad.status, 400);
	assert.match((bad.json as { error: string }).error, /tickets\.day-pass/);
	assert.equal((await api(put({ kind: 'tickets', id: 'Day Pass', record: { name: 'x' }, base: libraryVersion(root) }))).status, 400);
	assert.equal((await api(put({ kind: 'stops', id: 'day-pass', record: {}, base: libraryVersion(root) }))).status, 400);
	assert.equal((await api(put({ kind: 'huts', id: 'x', record: {}, base: libraryVersion(root) }))).status, 400);
	assert.equal((await api(put({ kind: 'tickets', id: 'x', record: {} }))).status, 400);
	assert.equal(libraryBytes(root), after);
});

test('a stale library write is refused and nothing is written', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const base = libraryVersion(root);
	// Another tab (or the CLI) writes first.
	assert.equal((await api(put({ kind: 'tickets', id: 'day-pass', record: { name: 'Day pass' }, base }))).status, 200);
	const written = libraryBytes(root);
	const stale = await api(put({ kind: 'tickets', id: 'week-pass', record: { name: 'Week pass' }, base }));
	assert.equal(stale.status, 409);
	assert.equal((stale.json as { version: string }).version, libraryVersion(root));
	assert.equal(libraryBytes(root), written);
	// Two writes at once on the same base: one lands, the other is refused.
	const both = await Promise.all([
		api(put({ kind: 'tickets', id: 'a', record: { name: 'A' }, base: libraryVersion(root) })),
		api(put({ kind: 'tickets', id: 'b', record: { name: 'B' }, base: libraryVersion(root) }))
	]);
	assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
});

test('a record in use cannot be deleted', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const before = libraryBytes(root);
	const r = await api(put({ kind: 'stops', id: FIRSTALM, record: null, base: libraryVersion(root) }));
	assert.equal(r.status, 400);
	assert.match((r.json as { error: string }).error, /2026-09-20-duernbachwand, 2026-10-22-krettenburg_westerberg/);
	assert.equal(libraryBytes(root), before);
	// An unused one goes; one that isn't there is a 400.
	await api(put({ kind: 'tickets', id: 'day-pass', record: { name: 'Day pass' }, base: libraryVersion(root) }));
	const del = await api(put({ kind: 'tickets', id: 'day-pass', record: null, base: libraryVersion(root) }));
	assert.equal(del.status, 200);
	assert.equal(libraryBytes(root), before);
	assert.equal((await api(put({ kind: 'tickets', id: 'day-pass', record: null, base: libraryVersion(root) }))).status, 400);
	assert.equal(path.basename(repoPaths(root).factsLibrary), 'facts-library.json');
});

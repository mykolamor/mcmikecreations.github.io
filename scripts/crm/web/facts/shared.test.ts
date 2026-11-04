import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_ID_RE, specAt, type Spec } from '$lib/hikes/facts-spec';
import { readHikeFacts, validateLibraryRecord } from '$lib/hikes/facts.server';
import { emptyFactsLibrary, type FactsLibrary } from '$lib/hikes/facts-library.server';
import { REMOVE, localFacts } from './facts-state';
import { inheritedRows, overrideOp } from './inherit';
import { changesText, entryEditOp, idProblem, newRecordId, newRecordOps, recordCtx, recordEdit, recordOf, recordUsers, stopRef, touchesRecord } from './shared';
import type { FactsCtx } from './facts-state';
import { libraryClient, recordSession, refreshSession, type LibraryCall, type LibraryState } from './shared';
import { ApiClientError } from '../api';
import { createApi } from '../../server/api';
import { makeTempRepo } from '../../server/test-repo';
import { repoPaths } from '../../server/paths';
import { readFileSync } from 'node:fs';
import { recordId } from '../../shared/library-id';

type List = Extract<Spec, { t: 'list' }>;
const list = (path: (string | number)[]) => specAt(path) as List;

const nodes = [{ ref: 'node/1', lat: 47.5, lon: 11.5, tags: { name: 'Quelle' } }, { ref: 'node/2', lat: 47.51, lon: 11.51, tags: { name: 'Hut' } }];
const coords = [[11.5, 47.5, 1000], [11.51, 47.51, 1200], [11.52, 47.52, 1300]];
const site = (sidecar: unknown, post: unknown, library: FactsLibrary) =>
	readHikeFacts({ sidecar, post, postSource: 'post', sidecarSource: 'side', nodes, coords, distanceFactor: 1, library });

const BUS = { mode: 'bus', from: 'Munich', to: 'Hut', line: '9', note: { en: 'Every hour', de: 'Stündlich' }, checked: '2026-10-01' };
const library = (): FactsLibrary => ({ ...emptyFactsLibrary(), transport: { 'bus-9-hut': structuredClone(BUS) }, stops: { 'node/2': { kind: 'alpine-hut', water: true } } }) as unknown as FactsLibrary;

test('a new record from an entry leaves the entry as use or at', () => {
	const entry = { mode: 'bus', from: 'Munich', to: 'Hut', line: '9', note: { en: 'Every hour', de: '' }, checked: '2026-10-01' };
	// The id prefill: the Plan 2 rule, `-2` on a clash.
	assert.equal(recordId('transport', entry, {}), 'bus-9-hut');
	assert.equal(recordId('transport', entry, library().transport), 'bus-9-hut-2');
	assert.equal(recordId('tickets', { name: { en: 'Day pass', de: 'Tageskarte' } }, {}), 'day-pass');
	const path = ['access', 'transport', 1];
	const made = newRecordOps('transport', 'bus-9-hut', path, entry, 'post');
	// The record is the entry's fields, texts as the server keeps them; the entry is only its `use`.
	assert.deepEqual(made.record, { mode: 'bus', from: { en: 'Munich' }, to: 'Hut', line: '9', note: { en: 'Every hour' }, checked: '2026-10-01' });
	assert.deepEqual(made.ops, [{ kind: 'facts', scope: 'post', path, value: { use: 'bus-9-hut' } }]);
	validateLibraryRecord('transport', 'bus-9-hut', made.record, 'test');
	// An entry already using a record keeps none of its `use` in the new one.
	assert.deepEqual(newRecordOps('tickets', 'week', ['access', 'tickets', 0], { use: 'day', name: 'Week' }, 'hike').record, { name: { en: 'Week' } });
	// A stop is keyed by its place: the record leaves `at` out, the entry keeps it as written.
	const stop = newRecordOps('stops', 'node/2', ['stops', 0], { at: 'Hut', kind: 'alpine-hut', food: true }, 'hike');
	assert.deepEqual(stop.record, { kind: 'alpine-hut', food: true });
	assert.deepEqual(stop.ops, [{ kind: 'facts', scope: 'hike', path: ['stops', 0], value: { at: 'Hut' } }]);
	// Read by the site with the new record, the entries give back what they held.
	const lib = { ...emptyFactsLibrary(), transport: { 'bus-9-hut': made.record }, stops: { 'node/2': stop.record } } as FactsLibrary;
	const before = site({ stops: [{ at: 'Hut', kind: 'alpine-hut', food: true }], access: { transport: [{ ...entry, note: 'Every hour' }] } }, undefined, emptyFactsLibrary());
	const after = site({ stops: [{ at: 'Hut' }], access: { transport: [{ use: 'bus-9-hut' }] } }, undefined, lib);
	assert.deepEqual(after.facts?.stops, before.facts?.stops);
	assert.deepEqual(after.facts?.access?.transport, before.facts?.access?.transport);
});

test('an edit on a used entry writes only the changed field', () => {
	const lib = library();
	const hike = { access: { transport: [{ use: 'bus-9-hut', ticket: 'Day ticket' }] } };
	const doc = { facts: { hike, post: null } };
	const at = ['access', 'transport', 0];
	const own = hike.access.transport[0];
	const record = recordOf('transport', own, lib);
	assert.deepEqual(record, BUS);
	// A field the record has, and one it hasn't: each lands alone in the entry.
	const ops = [entryEditOp('hike', at, own, ['frequency'], { en: 'Hourly', de: '' }), entryEditOp('hike', at, own, ['note'], { en: 'Full on Sundays' })];
	assert.deepEqual(ops, [
		{ kind: 'facts', scope: 'hike', path: [...at, 'frequency'], value: { en: 'Hourly', de: '' } },
		{ kind: 'facts', scope: 'hike', path: [...at, 'note'], value: { en: 'Full on Sundays' } }
	]);
	const local = localFacts(doc, ops.filter((op) => op !== null), 'hike') as typeof hike;
	assert.deepEqual(local.access.transport, [{ use: 'bus-9-hut', ticket: 'Day ticket', frequency: { en: 'Hourly' }, note: { en: 'Full on Sundays' } }]);
	// The site takes the rest from the record, and the entry's own note over the record's (its German too, per language).
	const read = site(local, undefined, lib).facts?.access?.transport?.[0] as unknown as Record<string, unknown>;
	assert.equal(read.line, '9');
	assert.deepEqual(read.note, { en: 'Full on Sundays', de: 'Stündlich' });
	// Removing a value the entry doesn't hold writes nothing (the record's stays).
	assert.equal(entryEditOp('hike', at, own, ['line'], REMOVE), null);
	assert.deepEqual(entryEditOp('hike', at, own, ['ticket'], REMOVE), { kind: 'facts', scope: 'hike', path: [...at, 'ticket'], remove: true });
	// "This visit" on the hike's entry: its `use` and the one field, not the record's required values.
	const transport = list(['access', 'transport']);
	const [row] = inheritedRows(transport, hike.access.transport, undefined, (e) => recordOf('transport', e, lib));
	assert.deepEqual(overrideOp(transport, ['access', 'transport'], row, 'note', 'Late').value, { use: 'bus-9-hut', note: { en: 'Late' } });
	// A stop by its place: `at` alone.
	const stops = list(['stops']);
	const [hut] = inheritedRows(stops, [{ at: { ref: 'node/2' } }], undefined, (e) => recordOf('stops', e, lib));
	assert.deepEqual(overrideOp(stops, ['stops'], hut, 'food', true).value, { at: { ref: 'node/2' }, food: true });
});

test("a use entry pairs through its record with the visit's entry", () => {
	const lib = library();
	const transport = list(['access', 'transport']);
	const take = (e: Record<string, unknown>) => recordOf('transport', e, lib);
	const rows = inheritedRows(transport, [{ use: 'bus-9-hut' }], [{ mode: 'bus', from: 'Munich', to: 'Hut', note: 'Late' }], take);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].post?.note, 'Late');
	assert.deepEqual(rows[0].record, BUS);
	// As the site pairs them.
	const read = site({ access: { transport: [{ use: 'bus-9-hut' }] } }, { access: { transport: [{ mode: 'bus', from: 'Munich', to: 'Hut', note: 'Late' }] } }, lib);
	assert.equal(read.facts?.access?.transport?.length, 1);
});

test("a stop's record is found by its ref, or by the place the preview resolved", () => {
	const lib = library();
	assert.equal(stopRef({ ref: 'node/2' }), 'node/2');
	assert.equal(stopRef('Hut'), null);
	const resolved = [{ at: { name: { en: 'Hut' }, ref: 'node/2', resolved: true } }, { at: { name: { en: 'Lake' }, lat: 1, lon: 2, resolved: true } }];
	assert.equal(stopRef('hut ', resolved), 'node/2');
	assert.equal(stopRef('Lake', resolved), null);
	assert.equal(stopRef('km 2', resolved), null);
	assert.deepEqual(recordOf('stops', { at: 'Hut' }, lib, resolved), { kind: 'alpine-hut', water: true });
	assert.equal(recordOf('stops', { at: 'Hut' }, lib), undefined);
	assert.equal(recordOf('transport', { use: 'nope' }, lib), undefined);
});

test('a record edit keeps the text rule; saving many hikes names them', () => {
	const r = recordEdit('transport', structuredClone(BUS), ['note'], { en: 'Every hour', de: '' });
	assert.deepEqual(r, { record: { ...BUS, note: { en: 'Every hour' } } });
	assert.deepEqual(recordEdit('transport', structuredClone(BUS), ['note'], { en: '', de: 'Stündlich' }), { error: 'English is required while there is a translation' });
	assert.deepEqual(recordEdit('transport', structuredClone(BUS), ['line'], REMOVE), { record: { mode: 'bus', from: 'Munich', to: 'Hut', note: BUS.note, checked: BUS.checked } });
	assert.deepEqual(recordEdit('transport', { mode: 'bus', price: [{ amount: 3 }] }, ['price', 0, 'amount'], REMOVE), { record: { mode: 'bus' } });
	assert.deepEqual(recordEdit('tickets', {}, ['price', 0, 'amount'], 3), { record: { price: [{ amount: 3 }] } });
	// N counts hikes, the docs named.
	const usage = { 'stops/way/1': ['2026-09-20-a', '2026-10-01-a', 'b'], 'stops/way/2': ['2026-09-20-a'] };
	assert.deepEqual(recordUsers(usage, 'stops', 'way/1'), { hikes: 2, docs: ['2026-09-20-a', '2026-10-01-a', 'b'] });
	assert.deepEqual(recordUsers(usage, 'tickets', 'x'), { hikes: 0, docs: [] });
	assert.equal(changesText(recordUsers(usage, 'stops', 'way/1')), 'This changes 2 hikes: 2026-09-20-a, 2026-10-01-a, b');
	assert.equal(changesText(recordUsers(usage, 'stops', 'way/2')), null);
});

test('a save that changes which record an entry takes reloads the usage, others not', () => {
	const op = (path: (string | number)[], value: unknown = 'x') => ({ kind: 'facts' as const, scope: 'hike' as const, path, value });
	assert.equal(touchesRecord(op(['access', 'transport', 0, 'use'])), true);
	assert.equal(touchesRecord(op(['stops', 1, 'at'], { ref: 'node/2' })), true);
	// A whole entry, a whole list, or a container above it may hold a `use` or an `at`.
	assert.equal(touchesRecord(op(['access', 'tickets', 0], { use: 'day' })), true);
	assert.equal(touchesRecord(op(['stops'], [])), true);
	assert.equal(touchesRecord(op(['access'], {})), true);
	assert.equal(touchesRecord({ kind: 'facts', scope: 'post', path: ['access', 'lifts', 2], remove: true }), true);
	// A field beside them, or anything outside the library lists, isn't.
	assert.equal(touchesRecord(op(['access', 'transport', 0, 'note'])), false);
	assert.equal(touchesRecord(op(['access', 'transport', 0, 'at'])), false);
	assert.equal(touchesRecord(op(['stops', 0, 'use'])), false);
	assert.equal(touchesRecord(op(['access', 'note'])), false);
	assert.equal(touchesRecord(op(['water', 0, 'at'])), false);
	assert.equal(touchesRecord({ field: 'title', value: 'x' } as never), false);
});

test('a new record may take the id of a record no doc uses', () => {
	const state = { version: 'v', library: library(), usage: { 'transport/bus-9-hut': [], 'stops/node/2': ['2026-09-20-a'] } as Record<string, string[]> };
	const entry = { mode: 'bus', from: 'Munich', to: 'Hut', line: '9' };
	// A retry after the entry's ops failed: the record it left is reused, not `-2`.
	assert.equal(newRecordId('transport', entry, state), 'bus-9-hut');
	assert.equal(idProblem('transport', 'bus-9-hut', state), null);
	state.usage['transport/bus-9-hut'] = ['b'];
	assert.equal(newRecordId('transport', entry, state), 'bus-9-hut-2');
	assert.equal(idProblem('transport', 'bus-9-hut', state), '"bus-9-hut" is taken');
	assert.equal(idProblem('transport', 'Bus 9', state), 'An id is lowercase words joined by "-"');
	// A stop's id is its place's ref.
	assert.equal(newRecordId('stops', { at: { ref: 'node/2' } }, state), 'node/2');
	assert.equal(idProblem('stops', 'node/2', state), '"node/2" is taken');
	assert.equal(idProblem('stops', 'node/3', state), null);
	assert.match(idProblem('stops', '', state) ?? '', /pick the stop's place/);
	assert.equal(LIBRARY_ID_RE.test('day-pass'), true);
});

test("an entry's `use` is read-only while its record is found", () => {
	const sent: unknown[] = [];
	const base = { lang: 'de', scope: 'hike', edit: () => {}, send: (op: unknown) => sent.push(op), move: () => {}, stated: () => [], doc: () => null } as unknown as FactsCtx;
	const ctx = recordCtx(base, ['access', 'transport', 0], { use: 'bus-9-hut' });
	assert.equal(ctx.fixed?.(['access', 'transport', 0, 'use']), true);
	assert.equal(ctx.fixed?.(['access', 'transport', 0, 'note']), false);
	assert.equal(ctx.fixed?.(['access', 'transport', 1, 'use']), false);
	ctx.edit(['access', 'transport', 0, 'note'], 'x', false);
	assert.deepEqual(sent, [{ kind: 'facts', scope: 'hike', path: ['access', 'transport', 0, 'note'], value: 'x' }]);
});

/** The tab's library client on the real routes of a temp repo. */
function clientOn(root: string) {
	const api = createApi(root);
	const call: LibraryCall = async (method, body) => {
		const path = method === 'GET' ? '/api/facts/library' : '/api/facts/library/record';
		const r = await api({ method, path, query: new URLSearchParams(), headers: {}, json: body });
		if (r.status !== 200) throw new ApiClientError(r.status, (r.json as { error: string }).error, r.json);
		return r.json as LibraryState;
	};
	return { api, client: libraryClient(call, () => {}) };
}

test("a record edited elsewhere since Edit opened is refused, not overwritten", async () => {
	const root = makeTempRepo();
	const { api, client } = clientOn(root);
	const id = 'way/60315210';
	await client.load();
	// Edit opens: the draft remembers the version it was copied from, and the author changes it.
	let edit = recordSession(client.state()!, 'stops', id);
	const opened = edit.base;
	edit = { ...edit, draft: (recordEdit('stops', edit.draft, ['phone'], '+49 1') as { record: Record<string, unknown> }).record, touched: true };
	// Another tab writes the same record.
	const other = { ...client.state()!.library.stops[id], note: 'Changed elsewhere' };
	assert.equal((await api({ method: 'PUT', path: '/api/facts/library/record', query: new URLSearchParams(), headers: {}, json: { kind: 'stops', id, record: other, base: opened } })).status, 200);
	const written = readFileSync(repoPaths(root).factsLibrary, 'utf8');
	// Save: the usage is read again for its question, but the draft's version stays the base.
	const fresh = await client.load();
	assert.notEqual(fresh?.version, opened);
	assert.equal(refreshSession(edit, fresh!, 'stops', id).base, opened);
	assert.match((await client.put('stops', id, edit.draft, refreshSession(edit, fresh!, 'stops', id).base)) ?? '', /changed on disk/);
	assert.equal(readFileSync(repoPaths(root).factsLibrary, 'utf8'), written);
	// An untouched draft takes the fresh record and version when the open's reload answers.
	const reopened = refreshSession(recordSession({ ...fresh!, version: opened }, 'stops', id), fresh!, 'stops', id);
	assert.equal(reopened.base, fresh!.version);
	assert.equal(reopened.draft.note, 'Changed elsewhere');
});

test('a reload that started before a write answered is dropped', async () => {
	const pending: ((s: LibraryState) => void)[] = [];
	const shown: string[] = [];
	const call: LibraryCall = () => new Promise((resolve) => pending.push(resolve));
	const client = libraryClient(call, (s) => shown.push(s.version));
	const state = (version: string): LibraryState => ({ version, library: emptyFactsLibrary(), usage: {} });
	const load = client.load();
	const put = client.put('tickets', 'x', { name: 'X' }, 'v1');
	// The write answers first; the older read answers after it and is dropped.
	pending[1](state('v2'));
	assert.equal(await put, null);
	pending[0](state('v1'));
	await load;
	assert.deepEqual(shown, ['v2']);
	assert.equal(client.state()?.version, 'v2');
	// A read started after it is taken.
	const next = client.load();
	pending[2](state('v3'));
	await next;
	assert.equal(client.state()?.version, 'v3');
});

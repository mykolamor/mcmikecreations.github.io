import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApi, type ApiRequest } from '../server/api';
import { readDocFacts } from '../server/facts-read';
import { libraryVersion } from '../server/facts-library-api';
import { withDocLock } from '../server/doc-lock';
import { factsDocs } from '../server/facts-read';
import { repoPaths } from '../server/paths';
import { makeTempRepo } from '../server/test-repo';
import { extractLibrary } from '../oneoff/extract-facts-library';
import { mergeNearDuplicates, nearDuplicateGroups, pagesToCheck } from './facts-near-duplicates';

// A group is named by its exact key: two whose labels match (a translation apart) stay two.
const RB57 = {
	kind: 'transport',
	key: 'train RB 57 Munich Central Station → Gmund',
	group: 'transport|["train",{"de":"München Hbf","en":"Munich Central Station"},{"name":{"de":"Gmund","en":"Gmund"}},"RB 57"]'
};
const GASSLER = { file: 'gassler_berg.hike.json', path: 'access.transport[0]' };
const WASENKOGEL = { file: 'wasenkogel.hike.json', path: 'access.transport[0]' };
const POSTS = [
	{ kind: 'post', slug: 'gassler_berg', date: '2026-09-03' },
	{ kind: 'post', slug: 'wasenkogel', date: '2026-10-04' }
] as const;

const req = (method: string, route: string, json?: unknown): ApiRequest => ({ method, path: route, query: new URLSearchParams(), headers: {}, json });
const sidecar = (root: string, slug: string) => readFileSync(path.join(repoPaths(root).markdown, `${slug}.hike.json`), 'utf8');
const transport = (root: string, slug: string) => JSON.parse(sidecar(root, slug)).facts.access.transport[0];
const pages = (root: string) => POSTS.map((ref) => readDocFacts(root, ref));

test('groups match the one-off\'s for today\'s data', () => {
	const root = makeTempRepo();
	const groups = nearDuplicateGroups(root);
	assert.deepEqual(groups.map(({ id: _, record: __, ...g }) => g), extractLibrary(root, { dryRun: true }).nearDuplicates);
	assert.deepEqual([groups[0].id, groups[0].record], [RB57.group, undefined]);
	assert.deepEqual(groups.map((g) => [g.kind, g.key, g.entries.map((e) => e.file)]), [[RB57.kind, RB57.key, [GASSLER.file, WASENKOGEL.file]]]);
	assert.deepEqual(groups[0].entries[0].diff, ['ticket: {"en":"Deutschlandticket valid to Gmund","de":"Deutschlandticket bis Gmund gültig"}', 'note: (none)']);
});

test('kept-apart groups are not listed', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const listed = await api(req('GET', '/api/facts/near-duplicates'));
	assert.equal(listed.status, 200);
	assert.equal((listed.json as unknown[]).length, 1);
	assert.equal((await api(req('POST', '/api/facts/near-duplicates/keep', RB57))).status, 200);
	// Keeping it again adds nothing.
	assert.equal((await api(req('POST', '/api/facts/near-duplicates/keep', RB57))).status, 200);
	assert.deepEqual((await api(req('GET', '/api/facts/near-duplicates'))).json, []);
	assert.deepEqual(JSON.parse(readFileSync(path.join(repoPaths(root).crmData, 'near-duplicates-kept.json'), 'utf8')), [RB57]);
	assert.equal((await api(req('POST', '/api/facts/near-duplicates/keep', { kind: 'huts', key: 'x' }))).status, 400);
});

test('merge keeps each page: the converted entries read the same as before', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const before = pages(root);
	const wasenkogel = transport(root, 'wasenkogel');
	const r = await api(req('POST', '/api/facts/near-duplicates/merge', { ...RB57, chosen: GASSLER, id: 'train-rb-57-gmund' }));
	assert.equal(r.status, 200, JSON.stringify(r.json));
	assert.deepEqual(r.json, {
		ok: true,
		library: 'written',
		files: [
			{ file: GASSLER.file, status: 'saved' },
			{ file: WASENKOGEL.file, status: 'saved' }
		],
		kept: []
	});
	const library = JSON.parse(readFileSync(repoPaths(root).factsLibrary, 'utf8'));
	assert.equal(library.transport['train-rb-57-gmund'].ticket.en, 'Deutschlandticket valid to Gmund');
	// The chosen entry is the record; the other keeps only where it differs.
	assert.deepEqual(transport(root, 'gassler_berg'), { use: 'train-rb-57-gmund' });
	assert.deepEqual(transport(root, 'wasenkogel'), { ticket: wasenkogel.ticket, note: wasenkogel.note, use: 'train-rb-57-gmund' });
	assert.deepEqual(pages(root), before);
	// Merged: they share the record now, so the group is gone.
	assert.deepEqual(nearDuplicateGroups(root), []);
});

test('an entry that lacks a field the record has stays out of the merge', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	const before = pages(root);
	const gassler = sidecar(root, 'gassler_berg');
	const base = libraryVersion(root);
	// A malformed id: nothing is written.
	assert.equal((await api(req('POST', '/api/facts/near-duplicates/merge', { ...RB57, chosen: WASENKOGEL, id: 'Bad Id' }))).status, 400);
	assert.equal(libraryVersion(root), base);
	const r = await api(req('POST', '/api/facts/near-duplicates/merge', { ...RB57, chosen: WASENKOGEL, id: 'train-rb-57-bad-wiessee' }));
	assert.equal(r.status, 200, JSON.stringify(r.json));
	assert.notEqual(libraryVersion(root), base);
	assert.deepEqual((r.json as { kept: unknown }).kept, [{ ...GASSLER, reason: 'kept: has no note' }]);
	assert.deepEqual((r.json as { files: unknown }).files, [{ file: WASENKOGEL.file, status: 'saved' }]);
	assert.equal(sidecar(root, 'gassler_berg'), gassler);
	assert.deepEqual(transport(root, 'wasenkogel'), { use: 'train-rb-57-bad-wiessee' });
	assert.deepEqual(pages(root), before);
});

const MERGE = { group: RB57.group, chosen: GASSLER, id: 'train-rb-57-gmund' };
const sidecarFile = (root: string, slug: string) => path.join(repoPaths(root).markdown, `${slug}.hike.json`);

/** Runs `change` under `lock` once `start()` has begun (its synchronous part: the groups, the checks), before it writes. */
async function meanwhile<T>(lock: string, change: () => void, start: () => Promise<T>): Promise<T> {
	let go!: () => void;
	const gate = new Promise<void>((r) => (go = r));
	const held = withDocLock(lock, async () => {
		await gate;
		change();
	});
	const run = start();
	go();
	await held;
	return run;
}

test('a merge that failed part way is retried with the same id', async () => {
	const root = makeTempRepo();
	const before = pages(root);
	const original = sidecar(root, 'wasenkogel');
	// wasenkogel's entry changes after the checks: the library and gassler are written, wasenkogel is not.
	const changed = original.replace('"Change in Gmund."', '"Change in Gmund!"');
	const r = await meanwhile('post:wasenkogel', () => writeFileSync(sidecarFile(root, 'wasenkogel'), changed), () => mergeNearDuplicates(root, MERGE));
	assert.deepEqual(r, {
		ok: false,
		error: 'wasenkogel.hike.json: changed on disk since the groups were read; the files before it are written',
		library: 'written',
		files: [
			{ file: GASSLER.file, status: 'saved' },
			{ file: WASENKOGEL.file, status: 'failed', error: 'changed on disk since the groups were read' }
		],
		kept: []
	});
	assert.equal(sidecar(root, 'wasenkogel'), changed);
	assert.deepEqual(transport(root, 'gassler_berg'), { use: 'train-rb-57-gmund' });
	// Still listed, and the group's record is the one its merged entry takes, so the retry proposes it.
	writeFileSync(sidecarFile(root, 'wasenkogel'), original);
	assert.deepEqual(nearDuplicateGroups(root).map((g) => [g.id, g.record]), [[RB57.group, 'train-rb-57-gmund']]);
	const again = await createApi(root)(req('POST', '/api/facts/near-duplicates/merge', MERGE));
	assert.equal(again.status, 200, JSON.stringify(again.json));
	// gassler has nothing left to change.
	assert.deepEqual((again.json as { files: unknown }).files, [{ file: WASENKOGEL.file, status: 'saved' }]);
	assert.deepEqual(transport(root, 'wasenkogel').use, 'train-rb-57-gmund');
	assert.deepEqual(pages(root), before);
	assert.deepEqual(nearDuplicateGroups(root), []);
});

test('the id of a record a hike outside the group takes, or one that would change, is taken', async () => {
	const root = makeTempRepo();
	const api = createApi(root);
	// A record the group's own entry takes, with other content: writing it would change that entry's page.
	const lib = JSON.parse(readFileSync(repoPaths(root).factsLibrary, 'utf8'));
	lib.transport['train-rb-57-gmund'] = { mode: 'bus' };
	writeFileSync(repoPaths(root).factsLibrary, JSON.stringify(lib));
	writeFileSync(sidecarFile(root, 'gassler_berg'), sidecar(root, 'gassler_berg').replace('"mode": "train",', '"mode": "train",\n          "use": "train-rb-57-gmund",'));
	const r = await api(req('POST', '/api/facts/near-duplicates/merge', { ...MERGE, chosen: WASENKOGEL }));
	assert.equal(r.status, 400);
	assert.match((r.json as { error: string }).error, /"train-rb-57-gmund" is taken/);
	// The record as this merge would write it, but a hike outside the group (another line) takes it too.
	lib.transport['train-rb-57-gmund'] = transport(root, 'wasenkogel');
	writeFileSync(repoPaths(root).factsLibrary, JSON.stringify(lib));
	const other = JSON.parse(sidecar(root, 'duernbachwand'));
	other.facts.access = { ...other.facts.access, transport: [{ use: 'train-rb-57-gmund', line: 'RB 99' }] };
	writeFileSync(sidecarFile(root, 'duernbachwand'), JSON.stringify(other, null, 2) + '\n');
	const outside = await api(req('POST', '/api/facts/near-duplicates/merge', { ...MERGE, chosen: WASENKOGEL }));
	assert.equal(outside.status, 400);
	assert.match((outside.json as { error: string }).error, /"train-rb-57-gmund" is taken/);
});

test('a merge on a stale library is refused and nothing is written', async () => {
	const root = makeTempRepo();
	const files = [sidecar(root, 'gassler_berg'), sidecar(root, 'wasenkogel')];
	const lib = repoPaths(root).factsLibrary;
	const other = readFileSync(lib, 'utf8').replace('"tickets": {}', '"tickets": {\n\t\t"day-pass": {\n\t\t\t"name": "Day pass"\n\t\t}\n\t}');
	await assert.rejects(
		meanwhile('facts-library', () => writeFileSync(lib, other), () => mergeNearDuplicates(root, MERGE)),
		(e: { status?: number }) => e.status === 409
	);
	assert.equal(readFileSync(lib, 'utf8'), other);
	assert.deepEqual([sidecar(root, 'gassler_berg'), sidecar(root, 'wasenkogel')], files);
});

test('a stop merge keeps each stop\'s at, and checks every page', async () => {
	const root = makeTempRepo();
	// A place no stop names yet (the Benediktenwand peak, in the store): two hikes get a stop there, one with a note.
	const ref = 'node/26862546';
	const add = (slug: string, stop: Record<string, unknown>) => {
		const json = JSON.parse(sidecar(root, slug));
		json.facts.stops = [...(json.facts.stops ?? []), stop];
		writeFileSync(sidecarFile(root, slug), JSON.stringify(json, null, 2) + '\n');
		return json.facts.stops.length - 1;
	};
	const a = add('gassler_berg', { at: { ref }, kind: 'restaurant', food: true });
	const b = add('wasenkogel', { at: { ref }, kind: 'restaurant', food: true, note: 'Cash only.' });
	const group = nearDuplicateGroups(root).find((g) => g.kind === 'stops')!;
	assert.equal(group.key, ref);
	const all = factsDocs(root).map((d) => d.name);
	const before = all.map((name) => readDocFacts(root, factsDocs(root).find((d) => d.name === name)!.ref));
	const r = await createApi(root)(req('POST', '/api/facts/near-duplicates/merge', { group: group.id, chosen: { file: 'gassler_berg.hike.json', path: `stops[${a}]` }, id: ref }));
	assert.equal(r.status, 200, JSON.stringify(r.json));
	assert.deepEqual(JSON.parse(sidecar(root, 'gassler_berg')).facts.stops[a], { at: { ref } });
	assert.deepEqual(JSON.parse(sidecar(root, 'wasenkogel')).facts.stops[b], { at: { ref }, note: 'Cash only.' });
	assert.deepEqual(JSON.parse(readFileSync(repoPaths(root).factsLibrary, 'utf8')).stops[ref], { kind: 'restaurant', food: true });
	assert.deepEqual(all.map((name) => readDocFacts(root, factsDocs(root).find((d) => d.name === name)!.ref)), before);
	// A stop takes its record by place: every page is read before a stop merge, only the touched hikes' otherwise.
	assert.deepEqual(pagesToCheck(root, 'stops', new Set(['gassler_berg'])).map((d) => d.name), all);
	assert.deepEqual(pagesToCheck(root, 'transport', new Set(['gassler_berg'])).map((d) => d.name), ['2026-09-03-gassler_berg']);
});

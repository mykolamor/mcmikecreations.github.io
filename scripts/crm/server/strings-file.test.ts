import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApi, type ApiRequest } from './api';
import { ApiError } from './errors';
import { readStrings, stringsPath, writeStrings } from './strings-file';

const REAL = path.resolve(__dirname, '../../../src/lib/hikes/i18n');

/** A temp root holding the real tables, or the given ones (as JSON objects or exact text). */
function tablesRoot(tables?: Record<string, unknown>): string {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-strings-'));
	const dir = path.join(root, 'src/lib/hikes/i18n');
	mkdirSync(dir, { recursive: true });
	if (!tables) cpSync(REAL, dir, { recursive: true });
	for (const [lang, t] of Object.entries(tables ?? {})) writeFileSync(path.join(dir, `${lang}.json`), typeof t === 'string' ? t : JSON.stringify(t, null, '\t') + '\n');
	return root;
}
const bytes = (root: string, lang = 'de') => readFileSync(stringsPath(root, lang), 'utf8');
const changedLines = (a: string, b: string) => {
	const x = a.split('\n'), y = b.split('\n');
	assert.equal(x.length, y.length);
	return x.map((l, i) => (l === y[i] ? null : [l, y[i]])).filter(Boolean);
};

test('the tables read as dotted keys, with the file version', () => {
	const root = tablesRoot();
	const s = readStrings(root, 'de');
	assert.match(s.version, /^[0-9a-f]{40}$/);
	assert.equal(s.en['facts.labels.summary'], 'Summary');
	assert.equal(s.own['facts.labels.summary'], 'Überblick');
	assert.ok(Object.values(s.en).some(Array.isArray));
	assert.throws(() => readStrings(root, 'en'), (e: ApiError) => e.status === 400);
});

test("a table edit changes only its own key's bytes", async () => {
	const root = tablesRoot();
	const before = bytes(root);
	const { version } = readStrings(root, 'de');
	const r = await writeStrings(root, 'de', version, { 'facts.labels.summary': 'Zusammenfassung' });
	assert.deepEqual(changedLines(before, bytes(root)), [['\t\t\t"summary": "Überblick",', '\t\t\t"summary": "Zusammenfassung",']]);
	assert.equal(r.own['facts.labels.summary'], 'Zusammenfassung');
	assert.notEqual(r.version, version);

	// A paragraph list keeps its one-item-per-line layout; only the changed item's line differs.
	const list = Object.entries(r.own).find(([, v]) => Array.isArray(v) && v.length > 1)!;
	const items = [...(list[1] as string[])];
	const mid = bytes(root);
	items[0] = 'Neu';
	await writeStrings(root, 'de', r.version, { [list[0]]: items });
	assert.equal(changedLines(mid, bytes(root)).length, 1);

	// A one-line array stays on one line.
	const one = tablesRoot({ en: { months: ['Jan', 'Feb'], a: 'A' }, de: '{\n\t"months": ["Jan", "Feb"],\n\t"a": "Ä"\n}\n' });
	await writeStrings(one, 'de', readStrings(one, 'de').version, { months: ['Jän', 'Feb'] });
	assert.equal(bytes(one), '{\n\t"months": ["Jän", "Feb"],\n\t"a": "Ä"\n}\n');
});

test('a new key goes after its English neighbour', async () => {
	const en = { a: 'A', g: { x: 'X', y: 'Y', z: 'Z' }, m: { n: 'N', list: ['P', 'Q'] }, b: 'B' };
	const root = tablesRoot({ en, de: { a: 'Ä', g: { x: 'X1', z: 'Z1' }, b: 'B1' } });
	await writeStrings(root, 'de', readStrings(root, 'de').version, { 'g.y': 'Y1' });
	await writeStrings(root, 'de', readStrings(root, 'de').version, { 'm.n': 'N1', 'm.list': ['P1', 'Q1'] });
	assert.equal(
		bytes(root),
		'{\n\t"a": "Ä",\n\t"g": {\n\t\t"x": "X1",\n\t\t"y": "Y1",\n\t\t"z": "Z1"\n\t},\n\t"m": {\n\t\t"n": "N1",\n\t\t"list": [\n\t\t\t"P1",\n\t\t\t"Q1"\n\t\t]\n\t},\n\t"b": "B1"\n}\n'
	);
	// No English key before it in the file: at the end of its object.
	const first = tablesRoot({ en: { a: 'A', b: 'B' }, de: { b: 'B1' } });
	await writeStrings(first, 'de', readStrings(first, 'de').version, { a: 'A1' });
	assert.equal(bytes(first), '{\n\t"b": "B1",\n\t"a": "A1"\n}\n');
});

test('removing the last key of a group removes the group', async () => {
	const en = { a: 'A', m: { k: { n: 'N' } }, g: { x: 'X', y: 'Y' } };
	const root = tablesRoot({ en, de: { a: 'Ä', m: { k: { n: 'N1' } }, g: { x: 'X1', y: 'Y1' } } });
	await writeStrings(root, 'de', readStrings(root, 'de').version, { 'm.k.n': null, 'g.x': null });
	assert.equal(bytes(root), '{\n\t"a": "Ä",\n\t"g": {\n\t\t"y": "Y1"\n\t}\n}\n');
	// A blank text clears too.
	await writeStrings(root, 'de', readStrings(root, 'de').version, { 'g.y': '  ' });
	assert.equal(bytes(root), '{\n\t"a": "Ä"\n}\n');
});

test('a broken placeholder is refused', async () => {
	const root = tablesRoot();
	const before = bytes(root);
	const { version } = readStrings(root, 'de');
	await assert.rejects(writeStrings(root, 'de', version, { 'list.tagged': 'Hikes Tagged: {tag' }), (e: ApiError) => e.status === 400 && e.message.includes('list.tagged'));
	await assert.rejects(writeStrings(root, 'de', version, { 'no.such.key': 'x' }), (e: ApiError) => e.status === 400);
	await assert.rejects(writeStrings(root, 'en', version, { 'list.tagged': 'x' }), (e: ApiError) => e.status === 400);
	await assert.rejects(writeStrings(root, 'de', 'stale', { 'list.tagged': 'x' }), (e: ApiError) => e.status === 409);
	assert.equal(bytes(root), before);
});

test('GET and PATCH /api/strings; a stale base answers 409 with the version', async () => {
	const root = tablesRoot();
	const api = createApi(root);
	const req = (method: string, query: string, json?: unknown): ApiRequest => ({ method, path: '/api/strings', query: new URLSearchParams(query), headers: {}, json });
	const got = await api(req('GET', 'lang=de'));
	assert.equal(got.status, 200);
	const { version } = got.json as { version: string };
	const ok = await api(req('PATCH', '', { lang: 'de', base: version, set: { 'facts.labels.summary': 'Kurz' } }));
	assert.equal(ok.status, 200);
	assert.equal((ok.json as { own: Record<string, string> }).own['facts.labels.summary'], 'Kurz');
	const stale = await api(req('PATCH', '', { lang: 'de', base: version, set: { 'facts.labels.summary': 'Lang' } }));
	assert.equal(stale.status, 409);
	assert.equal((stale.json as { version: string }).version, (ok.json as { version: string }).version);
	assert.equal((await api(req('PATCH', '', { lang: 'de', base: version }))).status, 400);
});

test('a hand-broken table reads as 422 with the parse message', async () => {
	const root = tablesRoot({ en: { list: { tagged: 'Hikes tagged {tag}' } }, de: '{\n\t"list": {\n\t\t"tagged": "Wanderungen"\n\t\n}\n' });
	assert.throws(() => readStrings(root, 'de'), (e: ApiError) => e.status === 422 && /de\.json/.test(e.message) && /JSON/.test(e.message));
	const res = await createApi(root)({ method: 'GET', path: '/api/strings', query: new URLSearchParams('lang=de'), headers: {}, json: undefined });
	assert.equal(res.status, 422);
	assert.match((res.json as { error: string }).error, /de\.json/);
	await assert.rejects(writeStrings(root, 'de', 'any', { 'list.tagged': 'x' }), (e: ApiError) => e.status === 422);
});

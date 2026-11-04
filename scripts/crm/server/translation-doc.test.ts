import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTranslation, loadTranslation, saveTranslationOps, translationClientDoc } from './translation-doc';
import { TRANSLATION_FIELDS } from '../shared/fields';
import { problemsForRef } from './problems';
import { createApi } from './api';
import { repoPaths } from './paths';
import { ApiError } from './errors';
import type { DocRef } from './doc-ref';

type TranslationRef = Extract<DocRef, { kind: 'translation' }>;

const POST: TranslationRef = { kind: 'translation', source: { kind: 'post', slug: 'foo', date: '2024-01-01' }, lang: 'de' };
const PLACE: TranslationRef = { kind: 'translation', source: { kind: 'place', slug: 'knorrhuette' }, lang: 'de' };
const status = (n: number) => (e: unknown) => e instanceof ApiError && e.status === n;

function tmpRepo() {
	const root = mkdtempSync(join(tmpdir(), 'crm-tr-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	mkdirSync(p.places, { recursive: true });
	writeFileSync(join(p.markdown, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(p.markdown, '2024-01-01-foo.md'), '---\ntitle: Foo\n---\nBody\n');
	writeFileSync(join(p.places, 'knorrhuette.md'), '---\ntitle: Knorrhütte\ndescription: DAV hut.\n---\nPlace\n');
	return { root, post: join(p.markdown, '2024-01-01-foo.de.md'), place: join(p.places, 'knorrhuette.de.md'), source: join(p.markdown, '2024-01-01-foo.md') };
}

test('creating a translation writes an empty front matter', () => {
	const { root, post, place } = tmpRepo();
	const missing = loadTranslation(root, POST);
	assert.equal(missing.exists, false);
	assert.equal(missing.raw, '');
	assert.deepEqual(translationClientDoc(missing), { kind: 'translation', exists: false, version: missing.version, fields: {}, body: '' });
	createTranslation(root, POST);
	createTranslation(root, PLACE);
	assert.equal(readFileSync(post, 'utf8'), '---\n---\n');
	assert.equal(readFileSync(place, 'utf8'), '---\n---\n');
	const made = loadTranslation(root, POST);
	assert.equal(made.exists, true);
	assert.notEqual(made.version, missing.version);
	assert.deepEqual(translationClientDoc(made), { kind: 'translation', exists: true, version: made.version, fields: {}, body: '' });
	// The empty file is one the site reads, so it lists no problem.
	assert.deepEqual(problemsForRef(root, POST), []);
});

test('creating a translation without its source is refused', () => {
	const { root, post, source } = tmpRepo();
	rmSync(source);
	assert.throws(() => createTranslation(root, POST), status(400));
	assert.equal(existsSync(post), false);
	assert.throws(() => createTranslation(root, { ...PLACE, source: { kind: 'place', slug: 'gone' } }), status(400));
	// One left behind by a rename shows the site's error.
	writeFileSync(post, '---\ntitle: Foo (de)\n---\n');
	assert.deepEqual(problemsForRef(root, POST), [{ level: 'error', message: 'Translation 2024-01-01-foo.de.md: no 2024-01-01-foo.md beside it to translate' }]);
});

test('saving a translation whose source is gone is refused', () => {
	const { root, post, source } = tmpRepo();
	writeFileSync(post, '---\ntitle: Foo (de)\n---\n');
	rmSync(source);
	const base = loadTranslation(root, POST).version;
	assert.throws(
		() => saveTranslationOps(root, POST, base, [{ field: 'tr.title', value: 'Neu' }]),
		(e: unknown) => status(400)(e) && /No 2024-01-01-foo\.md to translate/.test((e as Error).message)
	);
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo (de)\n---\n');
});

test('creating over an existing translation is a 409', () => {
	const { root, post } = tmpRepo();
	writeFileSync(post, '---\ntitle: Foo (de)\n---\nText\n');
	assert.throws(() => createTranslation(root, POST), status(409));
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo (de)\n---\nText\n');
});

test('saving a title writes only that key, and clearing it removes it', () => {
	assert.deepEqual(TRANSLATION_FIELDS.map((f) => [f.id, f.file, f.path.join('.'), f.kind]), [
		['tr.title', 'translation', 'title', 'text'],
		['tr.description', 'translation', 'description', 'textarea'],
		['tr.aliases', 'translation', 'aliases', 'chips']
	]);
	const { root, post, place } = tmpRepo();
	createTranslation(root, POST);
	const r = saveTranslationOps(root, POST, loadTranslation(root, POST).version, [{ field: 'tr.title', value: 'Foo (de)' }]);
	assert.equal(r.ok, true);
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo (de)\n---\n');
	assert.deepEqual(r.doc.fields, { 'tr.title': 'Foo (de)' });
	assert.equal(r.doc.version, loadTranslation(root, POST).version);
	// The body, then the description, each leave the rest as it is.
	const b = saveTranslationOps(root, POST, r.doc.version, [{ kind: 'body', text: 'Der Text.\n' }, { field: 'tr.description', value: 'Über.' }]);
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo (de)\ndescription: Über.\n---\nDer Text.\n');
	// Cleared (empty, blank or null): the key goes, never an empty one the site refuses.
	const c = saveTranslationOps(root, POST, b.doc.version, [{ field: 'tr.title', value: '' }, { field: 'tr.description', value: '  ' }]);
	assert.equal(c.ok, true);
	assert.equal(readFileSync(post, 'utf8'), '---\n---\nDer Text.\n');
	assert.deepEqual(c.doc.fields, {});
	// A place doc's translation has aliases too; an empty list removes them.
	createTranslation(root, PLACE);
	const a = saveTranslationOps(root, PLACE, loadTranslation(root, PLACE).version, [{ field: 'tr.aliases', value: ['Knorr-Hütte'] }]);
	assert.equal(readFileSync(place, 'utf8'), '---\naliases:\n  - Knorr-Hütte\n---\n');
	assert.deepEqual(a.doc.fields, { 'tr.aliases': ['Knorr-Hütte'] });
	saveTranslationOps(root, PLACE, a.doc.version, [{ field: 'tr.aliases', value: [] }]);
	assert.equal(readFileSync(place, 'utf8'), '---\n---\n');
	// No file yet: create it first.
	rmSync(post);
	assert.throws(() => saveTranslationOps(root, POST, loadTranslation(root, POST).version, [{ field: 'tr.title', value: 'X' }]), status(404));
	assert.equal(existsSync(post), false);
});

test('aliases are refused on a post translation', () => {
	const { root, post } = tmpRepo();
	createTranslation(root, POST);
	const v = loadTranslation(root, POST).version;
	for (const op of [{ field: 'tr.aliases', value: ['X'] }, { field: 'post.title', value: 'X' }, { field: 'tr.title', value: 'X', scope: 'post' as const }, { kind: 'mirrors' as const, rows: [] }])
		assert.throws(() => saveTranslationOps(root, POST, v, [op]), status(400), JSON.stringify(op));
	// A result the site refuses is a 400 with the site's message; nothing is written.
	assert.throws(
		() => saveTranslationOps(root, POST, v, [{ kind: 'body', text: 'Text\n' }, { field: 'tr.title', value: 7 }]),
		(e) => e instanceof ApiError && e.status === 400 && e.message === 'Translation 2024-01-01-foo.de.md: title: expected text'
	);
	assert.equal(readFileSync(post, 'utf8'), '---\n---\n');
});

test('a stale base gets the current doc back', () => {
	const { root, post } = tmpRepo();
	createTranslation(root, POST);
	const v0 = loadTranslation(root, POST).version;
	writeFileSync(post, '---\ntitle: Elsewhere\n---\n');
	const r = saveTranslationOps(root, POST, v0, [{ field: 'tr.title', value: 'Mine' }]);
	assert.equal(r.ok, false);
	assert.deepEqual(r.doc.fields, { 'tr.title': 'Elsewhere' });
	assert.equal(r.doc.version, loadTranslation(root, POST).version);
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Elsewhere\n---\n');
});

test('the doc routes take a translation ref', async () => {
	const { root, post } = tmpRepo();
	const api = createApi(root);
	const query = new URLSearchParams({ slug: 'foo', date: '2024-01-01', lang: 'de' });
	const call = (method: string, path: string, json?: unknown) => api({ method, path, query, json, headers: {} });
	assert.deepEqual(((await call('GET', '/api/doc')).json as any).doc.exists, false);
	const made = await call('POST', '/api/translation/create');
	assert.equal(made.status, 200);
	const doc = (made.json as any).doc;
	assert.equal(doc.exists, true);
	assert.equal((await call('POST', '/api/translation/create')).status, 409);
	const ok = await call('PATCH', '/api/doc', { base: doc.version, ops: [{ field: 'tr.title', value: 'Foo (de)' }] });
	assert.equal(ok.status, 200);
	assert.deepEqual((ok.json as any).fields, { 'tr.title': 'Foo (de)' });
	const stale = await call('PATCH', '/api/doc', { base: doc.version, ops: [{ field: 'tr.title', value: 'X' }] });
	assert.equal(stale.status, 409);
	assert.equal((stale.json as any).body, '');
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo (de)\n---\n');
	assert.deepEqual(((await call('GET', '/api/problems')).json as any).problems, []);
	// Not a doc of its own for the post-only routes; the English post is untouched.
	assert.equal((await call('GET', '/api/map')).status, 400);
	assert.equal(readFileSync(join(repoPaths(root).markdown, '2024-01-01-foo.md'), 'utf8'), '---\ntitle: Foo\n---\nBody\n');
	assert.equal((await api({ method: 'POST', path: '/api/translation/create', query: new URLSearchParams({ slug: 'foo', date: '2024-01-01' }), headers: {} })).status, 400);
});

test('an empty front matter keeps a body with a thematic break', async () => {
	const { root, post } = tmpRepo();
	createTranslation(root, POST);
	const body = 'Eins\n\n---\n\nZwei\n';
	const a = saveTranslationOps(root, POST, loadTranslation(root, POST).version, [{ kind: 'body', text: body }]);
	assert.equal(readFileSync(post, 'utf8'), `---\n---\n${body}`);
	// Read again, the body is the whole text, not what follows its `---`.
	assert.equal(translationClientDoc(loadTranslation(root, POST)).body, body);
	assert.deepEqual(a.doc.fields, {});
	const b = saveTranslationOps(root, POST, a.doc.version, [{ kind: 'body', text: 'Neu\n' }]);
	assert.equal(readFileSync(post, 'utf8'), '---\n---\nNeu\n');
	saveTranslationOps(root, POST, b.doc.version, [{ kind: 'body', text: body }]);
	const query = new URLSearchParams({ slug: 'foo', date: '2024-01-01', lang: 'de' });
	const r = await createApi(root)({ method: 'PATCH', path: '/api/doc', query, json: { base: loadTranslation(root, POST).version, ops: [{ field: 'tr.title', value: 'T' }] }, headers: {} });
	assert.equal(r.status, 200);
	assert.equal(readFileSync(post, 'utf8'), `---\ntitle: T\n---\n${body}`);
});

test('a translation lists one problem at a time, as crm check does', () => {
	const { root, post, source } = tmpRepo();
	// A key the site refuses comes first, before the missing source.
	writeFileSync(post, '---\nplaces: [x]\n---\n');
	rmSync(source);
	assert.deepEqual(problemsForRef(root, POST), [{ level: 'error', message: 'Translation 2024-01-01-foo.de.md: unknown front matter key "places" (expected title, description)' }]);
	// No file at all: only the missing source.
	rmSync(post);
	assert.deepEqual(problemsForRef(root, POST), [{ level: 'error', message: 'Translation 2024-01-01-foo.de.md: no 2024-01-01-foo.md beside it to translate' }]);
});

test('a CRLF translation is listed as one the CRM cannot edit', async () => {
	const { root, post } = tmpRepo();
	writeFileSync(post, '---\r\ntitle: Foo (de)\r\n---\r\nText\r\n');
	const query = new URLSearchParams({ slug: 'foo', date: '2024-01-01', lang: 'de' });
	assert.equal((await createApi(root)({ method: 'GET', path: '/api/doc', query, headers: {} })).status, 422);
	assert.deepEqual(problemsForRef(root, POST), [{ level: 'warning', message: "CRLF front matter: the CRM can't edit it" }]);
});

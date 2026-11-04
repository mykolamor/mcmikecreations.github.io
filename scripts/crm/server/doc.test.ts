import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDoc, readField } from './doc';
import { FIELDS } from '../shared/fields';
import { ApiError } from './errors';

function tmpRoot() {
	const root = mkdtempSync(join(tmpdir(), 'crm-doc-'));
	const md = join(root, 'static/_projects/data-viz/hikes/markdown');
	mkdirSync(md, { recursive: true });
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo",\n  "description": "Desc"\n}\n');
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: Foo post\ntags:\n  - x\n---\nBody\n');
	return { root, md };
}

test('loadDoc reads sidecar and post', () => {
	const { root } = tmpRoot();
	const d = loadDoc(root, 'foo', '2024-01-01');
	assert.equal(readField(d, FIELDS.find((f) => f.id === 'sidecar.name')!), 'Foo');
	assert.equal(readField(d, FIELDS.find((f) => f.id === 'post.title')!), 'Foo post');
	assert.deepEqual(readField(d, FIELDS.find((f) => f.id === 'post.tags')!), ['x']);
	assert.equal(readField(d, FIELDS.find((f) => f.id === 'post.people')!), undefined);
	const s = loadDoc(root, 'foo', null);
	assert.equal(s.postRaw, null);
	assert.equal(readField(s, FIELDS.find((f) => f.id === 'post.title')!), undefined);
	assert.throws(() => loadDoc(root, 'nope', null), (e) => e instanceof ApiError && e.status === 404);
	assert.throws(() => loadDoc(root, 'foo', '2020-02-02'), (e) => e instanceof ApiError && e.status === 404);
});

test('version changes when either file changes', () => {
	const { root, md } = tmpRoot();
	const v0 = loadDoc(root, 'foo', '2024-01-01').version;
	writeFileSync(join(md, '2024-01-01-foo.md'), '---\ntitle: Other\n---\nBody\n');
	const v1 = loadDoc(root, 'foo', '2024-01-01').version;
	writeFileSync(join(md, 'foo.hike.json'), '{\n  "name": "Foo2"\n}\n');
	const v2 = loadDoc(root, 'foo', '2024-01-01').version;
	assert.equal(new Set([v0, v1, v2]).size, 3);
});

test('readField throws 500 on invalid sidecar JSON', () => {
	const { root, md } = tmpRoot();
	writeFileSync(join(md, 'foo.hike.json'), '{ "name": ');
	const d = loadDoc(root, 'foo', null);
	assert.throws(() => readField(d, FIELDS[0]), (e) => e instanceof ApiError && e.status === 500);
});

import { readFileSync, statSync, utimesSync, readdirSync } from 'node:fs';
import { saveOps, clientDoc } from './doc';

test('stale base version is rejected with the current version', () => {
	const { root, md } = tmpRoot();
	const d = loadDoc(root, 'foo', '2024-01-01');
	const edited = '---\ntitle: Edited in IDE\n---\nBody\n';
	writeFileSync(join(md, '2024-01-01-foo.md'), edited);
	const r = saveOps(root, 'foo', '2024-01-01', d.version, [{ field: 'post.title', value: 'Mine' }]);
	assert.equal(r.ok, false);
	if (!r.ok) {
		assert.equal(r.doc.version, loadDoc(root, 'foo', '2024-01-01').version);
		assert.equal(r.doc.fields['post.title'], 'Edited in IDE');
	}
	assert.equal(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), edited);
});

test('saveOps writes the change, returns new version, leaves no temp files', () => {
	const { root, md } = tmpRoot();
	const d = loadDoc(root, 'foo', '2024-01-01');
	const r = saveOps(root, 'foo', '2024-01-01', d.version, [{ field: 'sidecar.name', value: 'Bar' }]);
	assert.equal(r.ok, true);
	assert.equal(r.doc.fields['sidecar.name'], 'Bar');
	assert.equal(r.doc.version, loadDoc(root, 'foo', '2024-01-01').version);
	assert.deepEqual(readdirSync(md).sort(), ['2024-01-01-foo.md', 'foo.hike.json']);
	assert.deepEqual(clientDoc(loadDoc(root, 'foo', '2024-01-01')).mirrors.map((r) => r.url), ['', '', '']);
});

test('ops touching only post fields leave the sidecar file mtime untouched', () => {
	const { root, md } = tmpRoot();
	const sp = join(md, 'foo.hike.json');
	const old = new Date('2020-01-01T00:00:00Z');
	utimesSync(sp, old, old);
	const d = loadDoc(root, 'foo', '2024-01-01');
	const r = saveOps(root, 'foo', '2024-01-01', d.version, [{ field: 'post.title', value: 'New' }]);
	assert.equal(r.ok, true);
	assert.equal(statSync(sp).mtimeMs, old.getTime());
	assert.match(readFileSync(join(md, '2024-01-01-foo.md'), 'utf8'), /title: New/);
});

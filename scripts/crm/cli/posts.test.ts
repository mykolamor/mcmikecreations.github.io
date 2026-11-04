import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoPaths } from '../server/paths';
import { docFiles, postFiles } from './posts';

test('postFiles and docFiles skip translation files', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-posts-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	mkdirSync(p.places, { recursive: true });
	for (const f of ['2026-07-19-foo.md', '2026-07-19-foo.de.md', '2026-07-19-foo.fr.md', 'foo.hike.json']) writeFileSync(path.join(p.markdown, f), '');
	for (const f of ['hut.md', 'hut.de.md']) writeFileSync(path.join(p.places, f), '');
	const names = (files: string[]) => files.map((f) => path.basename(f));
	assert.deepEqual(names(postFiles(root, [])), ['2026-07-19-foo.md']);
	assert.deepEqual(names(docFiles(root)), ['2026-07-19-foo.md', 'hut.md']);
});

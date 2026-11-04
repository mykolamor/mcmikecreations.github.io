import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkOf, readLinks, setLink, writeLinks } from './immich-links';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crm-links-'));
const S = '/images/projects/data-viz/hikes/stories/setzberg/';

test('setLink/linkOf round-trip and null removes', async () => {
	const root = tmp();
	assert.equal(linkOf(root, 'a.md', 'k.jpg'), undefined);
	await setLink(root, 'a.md', 'k.jpg', 'id1');
	assert.equal(linkOf(root, 'a.md', 'k.jpg'), 'id1');
	await setLink(root, 'a.md', 'k.jpg', null);
	assert.equal(linkOf(root, 'a.md', 'k.jpg'), undefined);
	assert.deepEqual(readLinks(root), {});
});

test('concurrent setLink calls lose nothing', async () => {
	const root = tmp();
	await Promise.all(Array.from({ length: 30 }, (_, i) => setLink(root, 'a.md', `k${i}.jpg`, `id${i}`)));
	assert.equal(Object.keys(readLinks(root)['a.md']).length, 30);
});

test('readLinks: missing file is {}, corrupt file is moved aside and throws', () => {
	const root = tmp();
	assert.deepEqual(readLinks(root), {});
	const dir = path.join(root, 'scripts/crm/data');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'immich-links.json'), '{ broken');
	assert.throws(() => readLinks(root), (e: any) => e.status === 500 && /unreadable — moved aside to/.test(e.message));
	const left = fs.readdirSync(dir);
	assert.ok(!left.includes('immich-links.json'));
	assert.ok(left.some((f) => f.startsWith('immich-links.json.corrupt-')));
	assert.deepEqual(readLinks(root), {});
});

test('writeLinks removes its tmp file when the rename fails', () => {
	const root = tmp();
	const dir = path.join(root, 'scripts/crm/data');
	fs.mkdirSync(path.join(dir, 'immich-links.json'), { recursive: true }); // a directory: rename onto it fails
	assert.throws(() => writeLinks(root, { a: {} }));
	assert.deepEqual(fs.readdirSync(dir), ['immich-links.json']);
});

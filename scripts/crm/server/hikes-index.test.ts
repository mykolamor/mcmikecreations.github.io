import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listHikes, suggestions } from './hikes-index';
import { repoPaths } from './paths';

test('the Open screen lists a post with a translation once', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-index-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	mkdirSync(p.places, { recursive: true });
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), '{"name": "Foo"}');
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), '---\ntitle: Foo\ntags: [a]\n---\nText\n');
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), '---\ntitle: Fuu\n---\nText\n');
	writeFileSync(path.join(p.places, 'hut.md'), '---\ntitle: Hut\ndescription: A hut.\n---\n');
	writeFileSync(path.join(p.places, 'hut.de.md'), '---\ntitle: Hütte\n---\n');
	const { postCount, hikes, places } = listHikes(root);
	assert.equal(postCount, 1);
	assert.deepEqual(hikes[0].posts.map((x) => path.basename(x.path)), ['2026-07-19-foo.md']);
	assert.deepEqual(places.map(({ slug, title }) => ({ slug, title })), [{ slug: 'hut', title: 'Hut' }]);
	assert.deepEqual(suggestions(root, 'places'), ['hut']);
	assert.deepEqual(suggestions(root, 'tags'), ['a']);
});

test('the Open screen tells which sidecar and posts have a facts sheet', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-index-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), '{"name": "Foo", "facts": {"difficulty": {"grade": "T2"}}}');
	writeFileSync(path.join(p.markdown, 'bar.hike.json'), '{"name": "Bar", "facts": {}}');
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), '---\ntitle: Foo\nfacts:\n  sources: [{title: X, url: "https://x.example"}]\n---\nText\n');
	writeFileSync(path.join(p.markdown, '2026-08-01-foo.md'), '---\ntitle: Foo again\n---\nText\n');
	writeFileSync(path.join(p.markdown, '2026-07-20-bar.md'), '---\ntitle: Bar\nfacts:\n---\nText\n');
	const { hikes } = listHikes(root);
	const bySlug = Object.fromEntries(hikes.map((h) => [h.slug, h]));
	assert.equal(bySlug.foo.hasFacts, true);
	assert.equal(bySlug.bar.hasFacts, false);
	assert.deepEqual(bySlug.foo.posts.map((x) => [x.date, x.hasFacts]), [['2026-08-01', false], ['2026-07-19', true]]);
	assert.deepEqual(bySlug.bar.posts.map((x) => x.hasFacts), [false]);
});

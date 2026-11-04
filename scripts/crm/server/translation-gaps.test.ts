import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listHikes } from './hikes-index';
import { repoPaths } from './paths';
import { docGaps, factsGap } from './translation-gaps';

const LANG = 'de' as const;
const repo = () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-gaps-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	mkdirSync(p.places, { recursive: true });
	return { root, p };
};
const FULL_NAME = { name: { en: 'Foo', de: 'Fu' }, description: { en: 'Walk', de: 'Gehen' } };
const POST = '---\ntitle: Foo\ndescription: A walk\n---\nFirst block.\n\nSecond block.\n';
const FULL_TR = '---\ntitle: Fu\ndescription: Ein Gang\n---\nErster Block.\n\nZweiter Block.\n';
const POST_REF = { kind: 'post', slug: 'foo', date: '2026-07-19' } as const;

test('a post with no translation file lacks its text and details', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify(FULL_NAME));
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), POST);
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['text', 'details']);
});

test('a fully translated post has no gap in that language', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify(FULL_NAME));
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), POST);
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), FULL_TR);
	assert.equal(docGaps(root, POST_REF)[LANG], undefined);
});

test('each part is reported on its own', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify(FULL_NAME));
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), POST);
	// A block short: text only.
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), '---\ntitle: Fu\ndescription: Ein Gang\n---\nErster Block.\n');
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['text']);
	// No description: details only.
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), '---\ntitle: Fu\n---\nErster Block.\n\nZweiter Block.\n');
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['details']);
	// The hike's name untranslated counts as details too.
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), FULL_TR);
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify({ name: { en: 'Foo' } }));
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['details']);
});

test('facts: an untranslated text, in the sidecar or the post, wherever it sits', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify({ ...FULL_NAME, facts: { summary: { en: 'Nice' } } }));
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), POST);
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.de.md'), FULL_TR);
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['facts']);
	assert.deepEqual(docGaps(root, { kind: 'hike', slug: 'foo' })[LANG], ['facts'], 'the hike alone has no text');
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify({ ...FULL_NAME, facts: { summary: { en: 'Nice', de: 'Schön' } } }));
	assert.equal(docGaps(root, POST_REF)[LANG], undefined);
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), '---\ntitle: Foo\ndescription: A walk\nfacts:\n  summary: Icy\n---\nFirst block.\n\nSecond block.\n');
	assert.deepEqual(docGaps(root, POST_REF)[LANG], ['facts']);
});

test('facts: a shared record the hike takes counts, unless the entry states that text itself', () => {
	const library = { stops: {}, lifts: {}, parking: {}, tickets: {}, transport: { bus: { mode: 'bus', note: { en: 'Rare' } } } } as any;
	const uses = (entry: object) => ({ access: { transport: [{ use: 'bus', ...entry }] } });
	assert.equal(factsGap(uses({}), LANG, library), true);
	assert.equal(factsGap(uses({ note: { en: 'Rare', de: 'Selten' } }), LANG, library), false, 'the entry overrides the record');
	assert.equal(factsGap(uses({ note: { en: 'Rare' } }), LANG, library), true, 'its own text untranslated');
	assert.equal(factsGap({ access: { transport: [{ use: 'unknown' }] } }, LANG, library), false);
	library.transport.bus.note.de = 'Selten';
	assert.equal(factsGap(uses({}), LANG, library), false);
});

test('facts: a mirror source is named by its platform, so its title needs no translation; any other source does', () => {
	const mirror = { title: 'Komoot', url: 'https://www.komoot.com/tour/1', kind: 'mirror' };
	assert.equal(factsGap({ sources: [mirror] }, LANG, null), false);
	assert.equal(factsGap({ sources: [mirror, { title: 'Trail report', url: 'https://example.com/a' }] }, LANG, null), true);
});

test('a place doc has text and details, and never facts', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.places, 'hut.md'), '---\ntitle: Hut\ndescription: A hut\n---\nBody.\n');
	assert.deepEqual(docGaps(root, { kind: 'place', slug: 'hut' })[LANG], ['text', 'details']);
	writeFileSync(path.join(p.places, 'hut.de.md'), '---\ntitle: Hütte\ndescription: Eine Hütte\n---\nText.\n');
	assert.equal(docGaps(root, { kind: 'place', slug: 'hut' })[LANG], undefined);
});

test('an unreadable or missing file reports no gap rather than failing', () => {
	const { root, p } = repo();
	assert.deepEqual(docGaps(root, POST_REF), {});
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), '---\n: : bad\n  - x\n---\nBody\n');
	assert.doesNotThrow(() => docGaps(root, POST_REF));
});

test('the Open screen: the hike row has its own gaps, each post and place its own', () => {
	const { root, p } = repo();
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), JSON.stringify({ name: { en: 'Foo' }, facts: { summary: { en: 'Nice' } } }));
	writeFileSync(path.join(p.markdown, '2026-07-19-foo.md'), POST);
	writeFileSync(path.join(p.places, 'hut.md'), '---\ntitle: Hut\n---\nBody.\n');
	const { hikes, places } = listHikes(root);
	assert.deepEqual(hikes[0].gaps[LANG], ['facts', 'details']);
	assert.deepEqual(hikes[0].posts[0].gaps[LANG], ['text', 'details']);
	assert.deepEqual(places[0].gaps[LANG], ['text', 'details']);
});

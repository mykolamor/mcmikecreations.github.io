import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFill, currentField, gatherDoc, gatherFacts, gatherRecord, gatherRoute, gatherStrings, runFill, type DocFill } from './fill';
import { ApiClientError } from '../api';
import { createDocSession } from '../doc-session';
import { at } from '../../shared/tree';
import { readHikeFacts } from '$lib/hikes/facts.server';
import { LIBRARY_KINDS, type FactsLibrary } from '$lib/hikes/facts-library.server';

const IMG = (n: number) => `![Photo ${n}](/images/projects/data-viz/hikes/stories/demo/p${n}.jpg)`;
/** The stub's answer to each text, as the server gives it: a heading's marker and a photo line's `![` stay at the start. */
const stub = (items: { id: string; text: string }[]) => items.map((i) => ({ id: i.id, text: i.text.replace(/^(#+ |!\[)?/, '$1⟨de⟩ ') }));
/** A photo line with its caption as the stub translates it. */
const DE = (n: number) => IMG(n).replace('![', '![⟨de⟩ ');
const doc = (en: string, body: string, title = '', description = ''): DocFill => ({ en, body, title, description });

test('a translation with an empty body gathers every English block', () => {
	const en = `## Up\n\nFirst [path](https://x.org).\n\n${IMG(1)}\n\nSecond.\n`;
	const items = gatherDoc(en, '', {}, { title: 'The hike', description: 'A walk' });
	assert.deepEqual(
		items.map((i) => [i.id, i.kind, i.text]),
		[
			['tr.title', 'plain', 'The hike'],
			['tr.description', 'plain', 'A walk'],
			['block:0', 'markdown', '## Up'],
			['block:1', 'markdown', 'First [path](https://x.org).'],
			['block:2', 'markdown', IMG(1)],
			['block:3', 'markdown', 'Second.']
		]
	);
	// The photo line comes back with its caption translated, its target kept: the translation reads complete.
	const r = applyFill(items, stub(items), doc(en, ''));
	assert.deepEqual(r.skipped, []);
	assert.equal(r.state.body, `## ⟨de⟩ Up\n\n⟨de⟩ First [path](https://x.org).\n\n${DE(1)}\n\n⟨de⟩ Second.\n`);
	assert.equal(r.state.title, '⟨de⟩ The hike');
	assert.equal(r.state.description, '⟨de⟩ A walk');
});

test('gather skips blocks and fields that already have text', () => {
	const en = `Intro.\n\n${IMG(1)}\n\nMiddle.\n\n## Top\n\nEnd.`;
	const tr = `Einleitung.\n\n${IMG(1)}\n\n## Gipfel`;
	const items = gatherDoc(en, tr, { title: 'Titel', description: '  ' }, { title: 'Title', description: 'Desc' });
	// The title has a translation; the blank description doesn't. The photo line copied as it is still has the English
	// caption, so it is gathered too.
	assert.deepEqual(
		items.map((i) => [i.id, i.text]),
		[
			['tr.description', 'Desc'],
			['block:1', IMG(1)],
			['block:2', 'Middle.'],
			['block:4', 'End.']
		]
	);
	// A photo line whose caption was translated by hand is left alone.
	const own = gatherDoc(en, tr.replace('Photo 1', 'Foto 1'), { title: 'Titel', description: 'D' }, { title: 'Title', description: 'Desc' });
	assert.deepEqual(own.map((i) => i.id), ['block:2', 'block:4']);
	// A copied photo line without a caption has nothing to translate.
	const bare = gatherDoc('A.\n\n![](/p.jpg)', 'a.\n\n![](/p.jpg)', { title: 'T', description: 'D' }, { title: 'T', description: 'D' });
	assert.deepEqual(bare, []);
	// No English, nothing to send.
	assert.deepEqual(gatherDoc('', '', {}, {}), []);
});

test('a copied photo line gets its caption filled in place, and a photo missing from the translation is added', () => {
	const en = `Intro.\n\n${IMG(1)}\n\nMiddle.\n\n${IMG(2)}`;
	const tr = `Einleitung.\n\n${IMG(1)}\n\nMitte.`;
	const items = gatherDoc(en, tr, { title: 'T', description: 'D' }, { title: 'T', description: 'D' });
	assert.deepEqual(items.map((i) => i.id), ['block:1', 'block:3']);
	const r = applyFill(items, stub(items), doc(en, tr, 'T', 'D'));
	assert.deepEqual(r.skipped, []);
	assert.equal(r.state.body, `Einleitung.\n\n${DE(1)}\n\nMitte.\n\n${DE(2)}`);
	// Captioned by hand while DeepL answered: the copied line isn't the English any more, so it is skipped.
	const typed = applyFill(items, stub(items), doc(en, tr.replace('Photo 1', 'Foto 1'), 'T', 'D'));
	assert.deepEqual(typed.skipped, ['block:1']);
});

test('fill skips fields that were filled meanwhile', async () => {
	const en = 'One.\n\nTwo.\n\nThree.';
	const items = gatherDoc(en, 'Eins.', {}, { title: 'Title', description: 'Desc' });
	assert.deepEqual(
		items.map((i) => i.id),
		['tr.title', 'tr.description', 'block:1', 'block:2']
	);
	// While the request is on its way the author types the title and the second block's translation.
	let state = doc(en, 'Eins.');
	const request = async <T>(_m: string, _p: string, body?: unknown): Promise<T> => {
		state = { ...state, title: 'Mein Titel', body: 'Eins.\n\nZwei.' };
		const texts = (body as { texts: { id: string; text: string }[] }).texts;
		return { texts: stub(texts), refused: [] } as T;
	};
	const r = await runFill('de', items, () => state, request);
	assert.deepEqual(r.applied, ['tr.description', 'block:2']);
	assert.deepEqual(r.skipped, ['tr.title', 'block:1']);
	assert.equal(r.state.title, 'Mein Titel');
	assert.equal(r.state.description, '⟨de⟩ Desc');
	assert.equal(r.state.body, 'Eins.\n\nZwei.\n\n⟨de⟩ Three.');
});

test('filled blocks land at their paired place', () => {
	const en = `## Up\n\nA.\n\nB.\n\n${IMG(1)}\n\nC.\n\n## Down\n\nD.`;
	const tr = `## Hinauf\n\na.\n\n${IMG(1)}\n\n## Hinab\n\nd.\n`;
	const items = gatherDoc(en, tr, { title: 'T', description: 'D' }, { title: 'T', description: 'D' });
	assert.deepEqual(
		items.map((i) => i.text),
		['B.', IMG(1), 'C.']
	);
	const r = applyFill(items, stub(items), doc(en, tr));
	assert.equal(r.state.body, `## Hinauf\n\na.\n\n⟨de⟩ B.\n\n${DE(1)}\n\n⟨de⟩ C.\n\n## Hinab\n\nd.\n`);
	// One was translated meanwhile: that one is skipped, the others still land at their place.
	const typed = applyFill(items, stub(items), doc(en, tr.replace(IMG(1), `${IMG(1)}\n\nc.`)));
	assert.deepEqual(typed.applied, ['block:2', 'block:3']);
	assert.deepEqual(typed.skipped, ['block:4']);
	assert.equal(typed.state.body, `## Hinauf\n\na.\n\n⟨de⟩ B.\n\n${DE(1)}\n\nc.\n\n## Hinab\n\nd.\n`);
	// The English changed meanwhile: its block isn't there to pair with any more.
	const gone = applyFill(items, stub(items), doc(en.replace('B.', 'Bee.'), tr));
	assert.deepEqual(gone.skipped, ['block:2']);
	// CRLF bodies keep their line breaks.
	const crlf = applyFill(gatherDoc('A.\n\nB.', 'a.\r\n', {}, {}), [{ id: 'block:1', text: 'b.' }], doc('A.\n\nB.', 'a.\r\n'));
	assert.equal(crlf.state.body, 'a.\r\n\r\nb.\r\n');
});

test('facts fill writes only empty languages', () => {
	const facts = {
		summary: 'A long day',
		exposure: { level: 2, note: { en: 'Short ridge', de: 'Kurzer Grat' } },
		bailouts: [{ at: 'x', note: { en: 'Steep', uk: 'Круто' } }, { at: 'y', note: { de: 'Nur Deutsch' } }],
		plan: { for: ['Families', { en: 'Dogs', de: 'Hunde' }] }
	};
	const items = gatherFacts(facts, 'de');
	assert.deepEqual(
		items.map((i) => [JSON.parse(i.id), i.text]),
		[
			[['summary'], 'A long day'],
			[['bailouts', 0, 'note'], 'Steep'],
			[['plan', 'for', 0], 'Families']
		]
	);
	const r = applyFill(items, stub(items), structuredClone(facts));
	assert.deepEqual(at(r.state, ['summary']), { en: 'A long day', de: '⟨de⟩ A long day' });
	assert.deepEqual(at(r.state, ['bailouts', 0, 'note']), { en: 'Steep', uk: 'Круто', de: '⟨de⟩ Steep' });
	assert.deepEqual(at(r.state, ['exposure', 'note']), facts.exposure.note);
	// A text given German meanwhile is skipped, the original never changed.
	const meanwhile = structuredClone(facts) as Record<string, unknown>;
	meanwhile.summary = { en: 'A long day', de: 'Ein langer Tag' };
	const m = applyFill(items, stub(items), meanwhile);
	assert.deepEqual(m.skipped, ['["summary"]']);
	assert.equal(facts.summary, 'A long day');
	// A shared record's texts, by its own fields.
	const rec = gatherRecord({ note: 'Book ahead', days: { en: 'Daily', de: 'Täglich' } }, 'de', 'stops');
	assert.deepEqual(
		rec.map((i) => [JSON.parse(i.id), i.text]),
		[[['note'], 'Book ahead']]
	);
});

test('link labels, point names and spot names are filled as their whole value', () => {
	const facts = {
		permits: [{ name: { en: 'Permit', de: 'Genehmigung' }, url: { url: 'https://x.org', label: 'Book' } }],
		water: [{ at: { lat: 47.1000001, lon: 11.27, name: 'Spring', demEle: 850 } }],
		route: { start: 'Car park', end: { name: 'Hut', at: { km: 2 } } },
		bailouts: [{ at: { lat: 47.1, lon: 11.28, name: { en: 'Saddle', de: 'Sattel' } } }]
	};
	const items = gatherFacts(facts, 'de');
	assert.deepEqual(
		items.map((i) => [JSON.parse(i.id), i.text, i.commitPath]),
		[
			[['permits', 0, 'url', 'label'], 'Book', ['permits', 0, 'url']],
			[['water', 0, 'at', 'name'], 'Spring', ['water', 0, 'at']],
			[['route', 'start', 'name'], 'Car park', ['route', 'start']],
			[['route', 'end', 'name'], 'Hut', ['route', 'end']]
		]
	);
	const r = applyFill(items, stub(items), structuredClone(facts));
	assert.deepEqual(r.applied.length, 4);
	assert.deepEqual(at(r.state, ['permits', 0, 'url']), { url: 'https://x.org', label: { en: 'Book', de: '⟨de⟩ Book' } });
	assert.deepEqual(at(r.state, ['water', 0, 'at']), { lat: 47.1000001, lon: 11.27, name: { en: 'Spring', de: '⟨de⟩ Spring' }, demEle: 850 });
	assert.deepEqual(at(r.state, ['route', 'start']), { name: { en: 'Car park', de: '⟨de⟩ Car park' } });
	assert.deepEqual(at(r.state, ['route', 'end']), { name: { en: 'Hut', de: '⟨de⟩ Hut' }, at: { km: 2 } });
	// A name given German meanwhile is skipped.
	const meanwhile = structuredClone(facts);
	(meanwhile.route as Record<string, unknown>).start = { name: { en: 'Car park', de: 'Parkplatz' } };
	assert.deepEqual(applyFill(items, stub(items), meanwhile).skipped, ['["route","start","name"]']);
	// The site reads every whole value it wrote.
	const library = Object.fromEntries(LIBRARY_KINDS.map((k) => [k, {}])) as unknown as FactsLibrary;
	const coords = [[11.2, 47.1, 800], [11.3, 47.1, 900]];
	const { facts: read } = readHikeFacts({
		sidecar: r.state, sidecarSource: 's.hike.json', postSource: 's.hike.json', nodes: [], storeNodes: [],
		origin: null, height: null, ownRefs: [], coords, distanceFactor: 1, library, readGpx: () => null
	} as any);
	assert.deepEqual(read!.route!.start!.name, { en: 'Car park', de: '⟨de⟩ Car park' });
	assert.deepEqual(read!.water![0].at.name, { en: 'Spring', de: '⟨de⟩ Spring' });
	// A shared record's link label, too.
	assert.deepEqual(
		gatherRecord({ booking: { url: 'https://h.at', label: 'Reserve' } }, 'de', 'stops').map((i) => [i.text, i.commitPath]),
		[['Reserve', ['booking']]]
	);
});

test('the strings and the route words gather what has no translation', () => {
	const rows = [
		{ key: 'a.b', en: 'Hikes tagged {tag}', missing: true },
		{ key: 'a.c', en: ['One.', 'Two.'], missing: true },
		{ key: 'a.d', en: 'Done', missing: false }
	];
	const items = gatherStrings(rows);
	assert.deepEqual(
		items.map((i) => [i.id, i.kind, i.text]),
		[
			['a.b', 'table', 'Hikes tagged {tag}'],
			['a.c', 'table', 'One.\n\nTwo.']
		]
	);
	const r = applyFill(items, stub(items), { 'a.b': '', 'a.c': 'Eins.' });
	assert.deepEqual(r.state, { 'a.b': '⟨de⟩ Hikes tagged {tag}', 'a.c': 'Eins.' });
	assert.deepEqual(r.skipped, ['a.c']);

	const texts = { 'sidecar.name': { en: 'Ridge' }, 'sidecar.description': { en: 'Up and down', de: 'Auf und ab' } };
	const route = gatherRoute(texts, 'de');
	assert.deepEqual(
		route.map((i) => [i.id, i.text]),
		[['sidecar.name', 'Ridge']]
	);
	assert.deepEqual(applyFill(route, stub(route), texts).state['sidecar.name'], { en: 'Ridge', de: '⟨de⟩ Ridge' });
});

test('an error applies nothing', async () => {
	const items = gatherDoc('One.', '', {}, { title: 'Title' });
	let read = 0;
	const current = () => (read++, doc('One.', ''));
	const failing = async <T>(): Promise<T> => {
		throw new ApiClientError(502, 'DeepL quota exceeded', { error: 'quota' });
	};
	await assert.rejects(runFill('de', items, current, failing), /quota/);
	assert.equal(read, 0);
	// Refused texts are reported with their label, and nothing is applied for them.
	const refusing = async <T>(): Promise<T> => ({ texts: [{ id: 'tr.title', text: 'Titel' }], refused: [{ id: 'block:0', reason: 'DeepL changed the line breaks' }] }) as T;
	const r = await runFill('de', items, current, refusing);
	assert.deepEqual(r.applied, ['tr.title']);
	assert.deepEqual(r.refused, [{ id: 'block:0', label: 'Block 1: One.', reason: 'DeepL changed the line breaks' }]);
	assert.equal(r.state.body, '');
	// A conflict raised while the request was on its way: nothing is read or applied, and it says why.
	const answering = async <T>(): Promise<T> => ({ texts: [{ id: 'tr.title', text: 'Titel' }], refused: [] }) as T;
	read = 0;
	await assert.rejects(runFill('de', items, current, answering, () => 'Changed on disk meanwhile'), /Changed on disk meanwhile/);
	assert.equal(read, 0);
	// Nothing to fill: no request at all.
	const none = await runFill('de', [], current, failing);
	assert.deepEqual([none.applied, none.skipped, none.refused], [[], [], []]);
});

test('a field reads as its queued value, else the doc\'s', async () => {
	const request = async <T>(): Promise<T> => ({ doc: { version: '1', fields: { 'tr.title': 'Alt' }, texts: { 'sidecar.name': { en: 'Ridge', de: 'Grat' } }, body: '' } }) as T;
	const session = createDocSession({ kind: 'hike', slug: 's' }, { request });
	await session.load();
	assert.equal(currentField(session, 'tr.title'), 'Alt');
	assert.equal(currentField(session, 'sidecar.name', 'de'), 'Grat');
	session.edit({ field: 'tr.title', value: 'Neu' }, true);
	session.edit({ field: 'sidecar.name', lang: 'de', value: '' }, true);
	assert.equal(currentField(session, 'tr.title'), 'Neu');
	assert.equal(currentField(session, 'sidecar.name', 'de'), '');
	assert.equal(currentField(session, 'sidecar.name'), undefined);
});

test('Fill leaves a mirror source\'s title alone', () => {
	const facts = { sources: [{ title: 'Komoot', url: 'https://www.komoot.com/tour/1', kind: 'mirror' }, { title: 'Trail report', url: 'https://example.com/a' }] };
	assert.deepEqual(gatherFacts(facts, 'de').map((i) => i.text), ['Trail report']);
});

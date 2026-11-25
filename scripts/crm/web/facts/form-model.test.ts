import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specAt } from '$lib/hikes/facts-spec';
import { mergeText, normaliseTexts, textEdit } from './form-model';
import { createSaveQueue } from '../save-queue';
import { editOp, localFacts, shownOps, statedTexts } from './facts-state';
import type { FieldOp } from '../../shared/ops';

test('normaliseTexts drops empty languages and writes English alone as {en}', () => {
	const spec = specAt(['water', 0])!;
	assert.deepEqual(normaliseTexts(spec, { at: 'Hut', note: { en: 'Tap', de: '' } }), { at: 'Hut', note: { en: 'Tap' } });
	assert.deepEqual(normaliseTexts(spec, { at: 'Hut', note: { en: 'Tap', de: 'Hahn' } }), { at: 'Hut', note: { en: 'Tap', de: 'Hahn' } });
	assert.deepEqual(normaliseTexts(spec, { at: 'Hut', note: { en: ' ', de: '' } }), { at: 'Hut' });
	// Through lists and into a price's note.
	const stops = specAt(['stops'])!;
	assert.deepEqual(normaliseTexts(stops, [{ at: 'A', price: [{ amount: 3, note: { en: 'cash' } }] }]), [{ at: 'A', price: [{ amount: 3, note: { en: 'cash' } }] }]);
	assert.deepEqual(normaliseTexts(specAt(['plan', 'for'])!, [{ en: 'kids' }, { en: '' }]), [{ en: 'kids' }]);
});

test('mergeText keeps other languages and refuses a cleared English beside a translation', () => {
	assert.deepEqual(mergeText({ en: 'A', fr: 'Ah' }, { en: 'B', de: '' }), { value: { en: 'B', fr: 'Ah' } });
	assert.deepEqual(mergeText('A', { en: 'B', de: '' }), { value: { en: 'B' } });
	assert.deepEqual(mergeText('A', { en: '', de: '' }), { value: undefined });
	assert.deepEqual(mergeText({ en: 'A', de: 'Ä' }, { en: '', de: 'Ä' }), { error: 'English is required while there is a translation' });
	assert.deepEqual(mergeText({ en: 'A', fr: 'Ah' }, { en: '', de: '' }), { error: 'English is required while there is a translation' });
	// A full text edit (as the text field builds it) is refused the same way.
	const saved = { en: 'Hello', de: 'Hallo' };
	assert.deepEqual(mergeText(saved, textEdit([saved], saved, 'en', '')), { error: 'English is required while there is a translation' });
});

/**
 * The text field's flow as the tab runs it: each edit is built from the shown facts (the doc with the ops in flight and
 * queued, re-read after every queue change as the tab's sync does) and queued debounced. A fake server merges each sent
 * text into the doc; `hold()` keeps the next send in flight until `release()`.
 */
function textFlow(saved: unknown) {
	const sent: FieldOp[][] = [];
	const doc = { facts: { hike: { summary: saved } as Record<string, unknown>, post: null } };
	let gate: Promise<void> | null = null;
	let open = () => {};
	const queue = createSaveQueue({
		send: async (ops) => {
			sent.push(ops);
			if (gate) await gate;
			for (const op of ops) {
				const r = mergeText(doc.facts.hike.summary, (op as { value: Record<string, string> }).value);
				if ('error' in r) throw Object.assign(new Error(r.error), { status: 400 });
				doc.facts.hike.summary = r.value;
			}
			return { conflict: false };
		},
		setTimer: () => 0,
		clearTimer: () => {}
	});
	let shown: FieldOp[] = [];
	const sync = () => (shown = shownOps(queue));
	queue.subscribe(sync);
	const local = () => (localFacts(doc, shown, 'hike') as { summary?: unknown } | undefined)?.summary;
	const edit = (lang: string, typed: string) => {
		const value = textEdit(statedTexts(doc, shown, 'hike', ['summary']), local(), lang, typed);
		queue.queue(editOp('hike', ['summary'], value), { debounce: true });
	};
	return {
		queue, doc, sent, local, edit,
		hold: () => (gate = new Promise<void>((r) => (open = r))),
		release: () => (gate = null, open()),
		last: () => (sent.at(-1)!.at(-1) as { value: Record<string, string> }).value
	};
}

test('two edits at one text path in different languages, coalesced, keep both', async () => {
	const t = textFlow('Hello');
	t.edit('de', 'Hallo');
	// the session language switched within the debounce
	t.edit('fr', 'Salut');
	t.edit('fr', 'Salut!');
	assert.equal(t.queue.pending().length, 1, 'coalesced into one op');
	assert.deepEqual(t.local(), { en: 'Hello', de: 'Hallo', fr: 'Salut!' });
	await t.queue.flush();
	assert.deepEqual(t.doc.facts.hike.summary, { en: 'Hello', de: 'Hallo', fr: 'Salut!' });
});

test('a cleared language stays cleared through English keystrokes coalesced after it', async () => {
	const t = textFlow({ en: 'Hello', de: 'Hallo' });
	t.edit('de', '');
	t.edit('en', 'Hi');
	t.edit('en', 'Hi!');
	assert.equal(t.queue.pending().length, 1, 'coalesced into one op');
	assert.deepEqual(t.local(), { en: 'Hi!' });
	await t.queue.flush();
	assert.equal(t.last().de, '');
	assert.deepEqual(t.doc.facts.hike.summary, { en: 'Hi!' });
});

test('a cleared language stays cleared through another language typed after it', async () => {
	const t = textFlow({ en: 'Hello', de: 'Hallo' });
	t.edit('de', '');
	t.edit('fr', 'S');
	t.edit('fr', 'Salut');
	await t.queue.flush();
	assert.equal(t.last().de, '');
	assert.deepEqual(t.doc.facts.hike.summary, { en: 'Hello', fr: 'Salut' });
});

test('a cleared language stays cleared with a send in flight between the edits', async () => {
	const t = textFlow({ en: 'Hello', de: 'Hallo' });
	t.hold();
	t.edit('de', '');
	const first = t.queue.flush();
	await Promise.resolve();
	assert.equal(t.queue.inFlight().length, 1, 'the clear is in flight');
	t.edit('en', 'Hi');
	t.edit('en', 'Hi!');
	t.edit('fr', 'Salut');
	assert.equal(t.last().de, '');
	assert.deepEqual(t.local(), { en: 'Hi!', fr: 'Salut' });
	t.release();
	await first;
	await t.queue.flush();
	assert.equal(t.last().de, '', 'the queued edit states the clear too');
	assert.deepEqual(t.doc.facts.hike.summary, { en: 'Hi!', fr: 'Salut' });
	assert.equal(t.queue.status, 'saved');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStringsSave, fromText, placeholders, rows, toText } from './rows';
import { ApiClientError } from '../api';

test('rows list missing keys first and flag placeholder mismatches', () => {
	const en = {
		'a.title': 'Page {page}',
		'a.missing': 'Missing',
		'a.form': 'Hikes from {year}{page, select, 1 {} other { - Page {page}}}',
		'a.plural': '{count, plural, one {# hike} other {# hikes}}',
		'a.case': '{kind, select, a {Alpha} other {Beta}}',
		'a.list': ['One {x}', 'Two'],
		'a.gone': 'Gone {tag}'
	};
	const own = {
		'a.title': 'Seite {seite}',
		'a.form': 'Touren aus {year}{page, select, 1 {} other { - Seite {page}}}',
		'a.plural': '{count, plural, one {# Tour} other {# Touren}}',
		'a.case': '{kind, select, a {Alfa} other {Beta}}',
		'a.list': ['Eins', 'Zwei'],
		'a.gone': 'Weg'
	};
	const r = rows(en, own);
	assert.deepEqual(
		r.map((x) => x.key),
		['a.missing', 'a.title', 'a.form', 'a.plural', 'a.case', 'a.list', 'a.gone']
	);
	const by = Object.fromEntries(r.map((x) => [x.key, x]));
	assert.deepEqual(by['a.missing'], { key: 'a.missing', en: 'Missing', own: undefined, missing: true, placeholders: [], mismatch: false });
	assert.deepEqual(by['a.title'].placeholders, ['page']);
	assert.equal(by['a.title'].mismatch, true);
	assert.deepEqual(by['a.form'].placeholders, ['page', 'year']);
	assert.equal(by['a.form'].mismatch, false);
	// `#` and a select case's text aren't placeholders.
	assert.deepEqual(by['a.plural'].placeholders, ['count']);
	assert.deepEqual(by['a.case'].placeholders, ['kind']);
	assert.equal(by['a.case'].mismatch, false);
	// A paragraph list is markdown, read verbatim.
	assert.equal(by['a.list'].mismatch, false);
	assert.equal(by['a.gone'].mismatch, true);
	assert.deepEqual(placeholders("Literal '{'x'}' and {y}"), ['y']);
});

test('a paragraph list edits as one text, split at blank lines', () => {
	assert.equal(toText(['One', 'Two\nlines']), 'One\n\nTwo\nlines');
	assert.deepEqual(fromText('One\n \nTwo\nlines\n\n\n', true), ['One', 'Two\nlines']);
	assert.equal(fromText(' \n\n', true), null);
	assert.equal(fromText('  ', false), null);
	assert.equal(fromText('Text ', false), 'Text ');
});

/** A save with a fake server and a manual timer. */
function harness(answer: (body: { base: string; set: Record<string, unknown> }) => unknown) {
	const sent: { base: string; set: Record<string, unknown> }[] = [];
	let fire: (() => void) | null = null;
	const save = createStringsSave('de', {
		request: async <T>(method: string, url: string, body?: unknown) => {
			if (method === 'GET') return { version: 'v-reload', en: {}, own: {} } as T;
			assert.equal(url, '/api/strings');
			sent.push(body as { base: string; set: Record<string, unknown> });
			return answer(body as { base: string; set: Record<string, unknown> }) as T;
		},
		setTimer: (fn) => (fire = fn),
		clearTimer: () => (fire = null)
	});
	return { save, sent, fire: () => fire?.() };
}

test('typing saves coalesced against the base version; a stale base is a conflict', async () => {
	let n = 0;
	const h = harness((b) => {
		if (b.base === 'v2') throw new ApiClientError(409, 'changed on disk', { version: 'v9' });
		return { version: `v${++n + 1}`, en: {}, own: b.set };
	});
	await h.save.load();
	assert.equal(h.save.version, 'v-reload');
	h.save.version = 'v1';
	h.save.set('a', 'A');
	h.save.set('a', 'AA');
	h.save.set('b', null);
	assert.equal(h.save.status, 'saving');
	h.fire();
	await h.save.idle();
	assert.deepEqual(h.sent, [{ lang: 'de', base: 'v1', set: { a: 'AA', b: null } }]);
	assert.equal(h.save.version, 'v2');
	assert.equal(h.save.status, 'saved');
	h.save.set('a', 'X');
	h.fire();
	await h.save.idle();
	assert.equal(h.save.status, 'conflict');
	// The edit is kept, and nothing more is sent until a reload.
	assert.deepEqual(h.save.pending(), { a: 'X' });
	h.save.set('c', 'C');
	h.fire();
	await h.save.idle();
	assert.equal(h.sent.length, 2);
	await h.save.load();
	assert.equal(h.save.status, 'saved');
	assert.deepEqual(h.save.pending(), {});
});

test('a refused save keeps its edits; a newer edit typed meanwhile wins', async () => {
	let fail = true;
	let release!: () => void;
	const h = harness(async (b) => {
		await new Promise<void>((r) => (release = r));
		if (fail) throw new ApiClientError(400, 'a: unclosed "{"');
		return { version: 'v3', en: {}, own: b.set };
	});
	h.save.version = 'v1';
	h.save.set('a', '{x');
	h.fire();
	await Promise.resolve();
	h.save.set('a', '{x}');
	release();
	await h.save.idle();
	assert.equal(h.save.status, 'error');
	assert.equal(h.save.error, 'a: unclosed "{"');
	assert.deepEqual(h.save.pending(), { a: '{x}' });
	fail = false;
	h.fire();
	await Promise.resolve();
	release();
	await h.save.idle();
	assert.equal(h.save.status, 'saved');
	assert.deepEqual(h.save.pending(), {});
});

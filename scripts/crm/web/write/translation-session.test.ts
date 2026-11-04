import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslations, translationSession } from './translation-session';
import { ownFolderFor } from './media-chips';
import type { ClientDocState } from '../doc-session';

const POST = { kind: 'post', slug: 'demo', date: '2026-07-01' } as const;
const PLACE = { kind: 'place', slug: 'knorrhuette' } as const;

/** A fake server: records each call and answers a translation doc (`exists` as given). */
function fakeServer(exists = true) {
	const calls: string[] = [];
	let made = exists;
	const doc = (): ClientDocState => ({ kind: 'translation', exists: made, version: made ? 'v1' : 'v0', fields: {}, body: '' });
	const request = async <T>(method: string, path: string): Promise<T> => {
		calls.push(`${method} ${path}`);
		if (method === 'POST' && path.startsWith('/api/translation/create')) made = true;
		return { doc: doc() } as T;
	};
	return { calls, request };
}

test('the translation session uses the source\'s own folder for chips', () => {
	const { request } = fakeServer();
	const post = translationSession(POST, 'de', { request });
	assert.deepEqual(post.ref, { kind: 'translation', source: POST, lang: 'de' });
	assert.equal(ownFolderFor(post.ref), ownFolderFor(POST));
	assert.equal(ownFolderFor(post.ref), '/images/projects/data-viz/hikes/stories/demo/');
	const place = translationSession(PLACE, 'de', { request });
	assert.equal(ownFolderFor(place.ref), ownFolderFor(PLACE));
});

test('switching language opens the translation session once', async () => {
	const { calls, request } = fakeServer(false);
	const translations = createTranslations(POST, { request });
	let opened = 0;
	translations.subscribe(() => opened++);
	assert.equal(translations.get('de'), null, 'nothing is opened before the Write tab switches to the language');

	const first = translations.open('de');
	const again = translations.open('de');
	assert.equal(first, again);
	assert.equal(translations.get('de'), first);
	await translations.loaded('de');
	assert.deepEqual(calls, ['GET /api/doc?slug=demo&date=2026-07-01&lang=de']);
	assert.equal(first.doc?.exists, false);
	assert.equal(opened, 1);

	// "Translate into German": created, then read again by the same session.
	await translations.create('de');
	assert.deepEqual(calls.slice(1), ['POST /api/translation/create?slug=demo&date=2026-07-01&lang=de', 'GET /api/doc?slug=demo&date=2026-07-01&lang=de']);
	assert.equal(translations.get('de'), first);
	assert.equal(first.doc?.exists, true);

	// Closed with the doc: no session left, nothing more is told.
	translations.close();
	assert.equal(translations.get('de'), null);
	assert.deepEqual(translations.all(), []);
});

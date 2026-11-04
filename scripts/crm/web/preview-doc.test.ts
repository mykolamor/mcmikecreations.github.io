import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewDocument } from './preview-doc';

const anchors = (doc: string) => [...doc.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);

test('in-page links stay in the frame; links that leave the page open a new tab', () => {
	const html =
		'<p><a class="mk-place" href="#hike-map" title="Show on the map">Hut</a><a class="mk-place-doc" href="#place-hut">ⓘ</a> ' +
		'<a href="/hikes/2024-09-29-rotwand/">Rotwand</a> <a href="https://example.com/">x</a> <a href="https://example.com/" target="_self">y</a></p>' +
		'<details id="place-hut"><summary>Hut</summary></details>';
	const doc = previewDocument(html, 'http://127.0.0.1:8765');
	assert.doesNotMatch(doc, /<base[^>]*target=/, 'no global target');
	assert.match(doc, /<base href="http:\/\/127\.0\.0\.1:8765\/">/, '/images/… still resolve against the CRM');
	assert.deepEqual(anchors(doc), [
		// The frame's own document: a bare `#…` would resolve against the base and load the CRM in the frame.
		'<a class="mk-place" href="about:srcdoc#hike-map" title="Show on the map">',
		'<a class="mk-place-doc" href="about:srcdoc#place-hut">',
		'<a href="/hikes/2024-09-29-rotwand/" target="_blank">',
		'<a href="https://example.com/" target="_blank">',
		'<a href="https://example.com/" target="_blank">'
	]);
});

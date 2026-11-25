// Run with: node_modules/.bin/jiti src/lib/hikes/map-utils.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTags, nodeName, nodePopupHtml, nodeTitle } from './map-utils';

test('the title prefers the name in the page language', () => {
	const tags = { name: 'अन्नपूर्णा III', 'name:en': 'Annapurna III', 'name:de': 'Annapurna III (de)', natural: 'peak' };
	assert.equal(nodeTitle(tags), 'Annapurna III');
	assert.equal(nodeTitle(tags, 'de'), 'Annapurna III (de)');
	assert.equal(nodeTitle({ name: 'Gatterl' }), 'Gatterl');
	assert.equal(nodeTitle({ 'name:en': 'Himalaya Cafe', amenity: 'cafe' }), 'Himalaya Cafe');
	assert.equal(nodeTitle({ natural: 'saddle' }), 'saddle');
	assert.equal(nodeTitle(null), 'POI');
	assert.match(nodePopupHtml({ name: 'पशुपतीनाथ', 'name:en': 'Pashupatinath Temple' }), /<b>Pashupatinath Temple<\/b>/);
	// The Web map's peak list gets no fallback to the tag.
	assert.equal(nodeName({ name: 'अन्नपूर्णा III', 'name:en': 'Annapurna III' }), 'Annapurna III');
	assert.equal(nodeName({ natural: 'peak' }), null);
});

// OSM data is anyone's to edit, and the popups are set as HTML.
const XSS = '<img src=x onerror=alert(1)>';
const XSS_TEXT = '&lt;img src=x onerror=alert(1)&gt;';

/** The `<a …>` start tags in `html`, each as its attribute names. */
const anchorAttributes = (html: string) =>
	[...html.matchAll(/<a\b([^>]*)>/g)].map(([, attrs]) => [...attrs.matchAll(/\s([a-z-]+)="[^"]*"/g)].map(([, name]) => name));

test('an OSM name, elevation and tag value render as text', () => {
	const html = nodePopupHtml({ name: XSS, ele: XSS, note: XSS });
	assert.ok(html.startsWith(`<div style="margin-bottom:8px;"><b>${XSS_TEXT}</b> (${XSS_TEXT}m)</div>`), html);
	assert.ok(!html.includes('<img'), html);
	assert.deepEqual(formatTags({ note: XSS }), [['Note', XSS_TEXT]]);
	assert.deepEqual(formatTags({ [`${XSS}:x`]: 'v' }), [['&lt;img Src=x Onerror=alert(1)&gt; X', 'v']]);
	assert.equal(nodeTitle({ name: XSS }), XSS, 'the title stays text, for aria-label and the peak list');
});

test('a quote in a website, email, phone or wiki tag cannot leave its attribute', () => {
	const quote = 'x" onmouseover="alert(1)';
	for (const key of ['website', 'contact:website', 'email', 'phone', 'mobile', 'wikipedia', 'wikidata']) {
		const html = nodePopupHtml({ name: 'Hut', [key]: quote });
		assert.ok(!html.includes('onmouseover="'), `${key}: ${html}`);
		for (const attrs of anchorAttributes(html)) assert.ok(!attrs.includes('onmouseover'), `${key}: ${html}`);
	}
	const [[, website]] = formatTags({ website: quote });
	assert.match(website, /^<a href="https:\/\/x&quot; onmouseover=&quot;alert\(1\)" target="_blank"/);
	const [[, email]] = formatTags({ email: `${XSS}"` });
	assert.equal(email, `<a href="mailto:${XSS_TEXT}&quot;" style="color: #2563eb; text-decoration: none;">${XSS_TEXT}&quot;</a>`);
	const [[, wiki]] = formatTags({ wikipedia: `de"x:${XSS}` });
	// A prefix that isn't a language code falls back to English and stays in the title.
	assert.ok(wiki.startsWith('<a href="https://en.wikipedia.org/wiki/de%22x%3A%3Cimg'), wiki);
	assert.ok(wiki.endsWith(`>de&quot;x:${XSS_TEXT}</a>`), wiki);
	// Nor choose a script scheme or another host.
	assert.match(formatTags({ website: 'javascript:alert(1)' })[0][1], /^<a href="https:\/\/javascript:alert\(1\)"/);
	assert.equal(formatTags({ wikidata: 'Q1"><img src=x>' })[0][1], 'Q1&quot;&gt;&lt;img src=x&gt;');
});


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
});

test('the popup heading uses it', () => {
	assert.match(nodePopupHtml({ name: 'पशुपतीनाथ', 'name:en': 'Pashupatinath Temple' }), /<b>Pashupatinath Temple<\/b>/);
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
});

test('real OSM values render as before', () => {
	// node/266995158 from osm.json, and its popup before escaping.
	const tags = {
		aerialway: 'station', email: 'info@tegelbergbahn.de', name: 'Tegelbergbahn (Talstation)', 'name:zh': 'tegelbergbahn纜車站',
		phone: '+49 8362 98360', public_transport: 'station', tourism: 'yes', website: 'https://www.tegelbergbahn.de/',
		wheelchair: 'yes', wikidata: 'Q1524386', wikipedia: 'en:Tegelberg Cable Car'
	};
	const td = '<td style="padding-right:8px;font-weight:600;font-size:11px;color:#6b7280;vertical-align:top;white-space:nowrap;">';
	const value = '<td style="font-size:11px;word-break:break-word;">';
	const link = 'style="color: #2563eb; text-decoration: none;"';
	const blank = `target="_blank" rel="noopener noreferrer" ${link}`;
	const row = (k: string, v: string) => `<tr>${td}${k}</td>${value}${v}</td></tr>`;
	assert.equal(
		nodePopupHtml(tags),
		'<div style="margin-bottom:8px;"><b>Tegelbergbahn (Talstation)</b></div><div style="max-height:150px;overflow-y:auto;"><table style="min-width:100%;border-spacing:0;">'
			+ row('Phone', `<a href="tel:+49 8362 98360" ${link}>+49 8362 98360</a>`)
			+ row('Website', `<a href="https://www.tegelbergbahn.de/" ${blank}>Link</a>`)
			+ row('Email', `<a href="mailto:info@tegelbergbahn.de" ${link}>info@tegelbergbahn.de</a>`)
			+ row('Wikipedia', `<a href="https://en.wikipedia.org/wiki/Tegelberg%20Cable%20Car" ${blank}>en:Tegelberg Cable Car</a>`)
			+ row('Wikidata', `<a href="https://www.wikidata.org/wiki/Q1524386" ${blank}>Q1524386</a>`)
			+ row('Aerialway', 'station') + row('Name Zh', 'tegelbergbahn纜車站') + row('Public Transport', 'station')
			+ row('Tourism', 'yes') + row('Wheelchair', 'yes')
			+ '</table></div>'
	);
	// A website without a scheme still gets https://; several phones still split.
	assert.deepEqual(formatTags({ website: 'www.barmsee.de', phone: '+49 8042 967112;+49 8042 5633096' }), [
		['Phone', `<a href="tel:+49 8042 967112" ${link}>+49 8042 967112</a>, <a href="tel:+49 8042 5633096" ${link}>+49 8042 5633096</a>`],
		['Website', `<a href="https://www.barmsee.de" ${blank}>Link</a>`]
	]);
	// An `&` or quote in a real name reads the same once escaped.
	assert.match(nodePopupHtml({ name: 'Tvrđava "Stari grad"' }), /<b>Tvrđava &quot;Stari grad&quot;<\/b>/);
	assert.deepEqual(formatTags({ website: 'https://www.eng.at/index.php?id=249&L=0' }), [
		['Website', `<a href="https://www.eng.at/index.php?id=249&amp;L=0" ${blank}>Link</a>`]
	]);
});

test('the title falls back the same way for the Web map\'s peak list', () => {
	assert.equal(nodeName({ name: 'Gatterl', natural: 'peak' }), 'Gatterl');
	assert.equal(nodeName({ name: 'अन्नपूर्णा III', 'name:en': 'Annapurna III' }), 'Annapurna III');
	assert.equal(nodeName({ natural: 'peak' }), null);
	assert.equal(nodeTitle({ natural: 'peak' }), 'peak');
});

test('a website, wikipedia or wikidata tag cannot choose a script scheme or another host', () => {
	const [[, website]] = formatTags({ website: 'javascript:alert(1)' });
	assert.match(website, /^<a href="https:\/\/javascript:alert\(1\)"/);
	const [[, wiki]] = formatTags({ wikipedia: 'evil.com/#:X' });
	assert.ok(wiki.startsWith('<a href="https://en.wikipedia.org/wiki/evil.com%2F%23%3AX"'), wiki);
	const [[, wikidata]] = formatTags({ wikidata: 'Q1"><img src=x>' });
	assert.ok(!wikidata.includes('<a'), wikidata);
	assert.equal(wikidata, 'Q1&quot;&gt;&lt;img src=x&gt;');
});

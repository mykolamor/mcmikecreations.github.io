import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webUrl, wikipediaUrl, wikidataUrl } from './web-url';

test('webUrl keeps http(s) URLs and gives everything else https://', () => {
	assert.equal(webUrl('https://hut.example/'), 'https://hut.example/');
	assert.equal(webUrl('http://hut.example'), 'http://hut.example');
	assert.equal(webUrl('HTTPS://Hut.example'), 'HTTPS://Hut.example');
	assert.equal(webUrl('  www.hut.example '), 'https://www.hut.example');
	assert.equal(webUrl('hut.example'), 'https://hut.example');
});

test('webUrl never lets a script or data scheme through', () => {
	for (const v of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', '\tjavascript:x', 'data:text/html,x', 'httpjavascript:alert(1)', 'vbscript:x']) {
		const url = webUrl(v);
		assert.match(url, /^https:\/\//, v);
	}
});

test('wikipediaUrl uses only a real language prefix as the host', () => {
	assert.equal(wikipediaUrl('en:Tegelberg Cable Car'), 'https://en.wikipedia.org/wiki/Tegelberg%20Cable%20Car');
	assert.equal(wikipediaUrl('de:Zugspitze'), 'https://de.wikipedia.org/wiki/Zugspitze');
	assert.equal(wikipediaUrl('zh-yue:X'), 'https://zh-yue.wikipedia.org/wiki/X');
	assert.equal(wikipediaUrl('Zugspitze'), 'https://en.wikipedia.org/wiki/Zugspitze');
	// A prefix that isn't a language code can't pick the host.
	assert.equal(wikipediaUrl('evil.com/#:X'), 'https://en.wikipedia.org/wiki/evil.com%2F%23%3AX');
	assert.equal(wikipediaUrl('de"x:Y'), 'https://en.wikipedia.org/wiki/de%22x%3AY');
});

test('wikidataUrl links only real item ids', () => {
	assert.equal(wikidataUrl('Q1524386'), 'https://www.wikidata.org/wiki/Q1524386');
	assert.equal(wikidataUrl('q42'), null);
	assert.equal(wikidataUrl('Q1"><img src=x>'), null);
});

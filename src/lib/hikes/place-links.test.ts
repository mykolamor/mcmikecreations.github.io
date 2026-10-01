// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/place-links.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceIndex, normalizePlaceName } from './place-links';
import { parseMarkdown } from './hikes-info';

const KNORR = { lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte', ele: '2052' } };
const KIRCHSTEIN = { lat: 47.6, lon: 11.5, tags: { name: 'Vorderer Kirchstein' } };
const KALMBERG = { lat: 47.6, lon: 13.6, tags: { name: 'Hoher Kalmberg', 'name:de': 'Kalmberg' } };
const TOVRE = { lat: 46.2, lon: 12.1, tags: { name: 'Palon de Tovre', ele: '1913 m' } };
const NODES = [KNORR, KIRCHSTEIN, KALMBERG, TOVRE, { lat: 1, lon: 1, tags: { natural: 'peak' } }];
const places = buildPlaceIndex(NODES)!;

test('normalization ignores case, accents, ß and hyphens', () => {
	assert.equal(normalizePlaceName('Roßkopf'), 'rosskopf');
	assert.equal(normalizePlaceName('Vorderer-Kirchstein'), normalizePlaceName('vorderer kirchstein'));
	assert.equal(normalizePlaceName('Feldernjöchl'), 'feldernjochl');
});

test('trailing words match a node name, leaving leading words out', () => {
	assert.deepEqual(places.match(['Approaching', 'Knorrhütte'], 2052), { start: 1, node: KNORR });
	assert.deepEqual(places.match(['Vorderer-Kirchstein'], 1670), { start: 0, node: KIRCHSTEIN });
});

test('spaces inside a name are ignored', () => {
	const index = buildPlaceIndex([{ lat: 1, lon: 2, tags: { name: 'Auerberg', ele: '1055' } }, KIRCHSTEIN, TOVRE])!;
	assert.equal(index.match(['Auer', 'Berg'], 1055)?.start, 0);
	assert.equal(index.match(['Auer-Berg'], 1055)?.start, 0);
	assert.deepEqual(index.match(['Vordererkirchstein'], 1670), { start: 0, node: KIRCHSTEIN });
	// And with the elevation check, against the node name's trailing whole words.
	assert.deepEqual(index.match(['De', 'Tovre'], 1913), { start: 0, node: TOVRE });
	assert.deepEqual(index.match(['Detovre'], 1913), { start: 0, node: TOVRE });
	assert.equal(index.match(['Ovre'], 1913), null);
});

test('the longest match wins', () => {
	assert.deepEqual(places.match(['Face-shaped', 'Hoher', 'Kalmberg'], 1833), { start: 1, node: KALMBERG });
	assert.deepEqual(places.match(['Kalmberg'], 1833), { start: 0, node: KALMBERG });
});

test('a node name ending in the reference matches only at the same height', () => {
	assert.deepEqual(places.match(['Tovre'], 1913), { start: 0, node: TOVRE });
	assert.deepEqual(places.match(['Tovre'], 1910), { start: 0, node: TOVRE });
	assert.equal(places.match(['Tovre'], 1700), null);
	// Only a whole trailing word counts: "Kirchstein" is not "…rchstein".
	assert.equal(places.match(['Rchstein'], 1670), null);
});

test('no names, no index', () => {
	assert.equal(buildPlaceIndex([{ lat: 1, lon: 1, tags: { natural: 'peak' } }]), null);
	assert.equal(buildPlaceIndex(null), null);
	assert.equal(places.match(['Zugspitze'], 2962), null);
});

const body = (md: string) => '---\ntitle: T\n---\n' + md;
const placeLinks = (html: string) => [...html.matchAll(/<a class="mk-place" href="#hike-map"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

test('prose references link to the map with the node position', async () => {
	const { html } = await parseMarkdown(body('Approaching Knorrhütte (2052 m), then Zugspitze (2962 m).\n\n- Past Hoher Kalmberg (1833 m)\n'), [], { nodes: NODES });
	assert.deepEqual(placeLinks(html), ['Knorrhütte (2052&nbsp;m)', 'Hoher Kalmberg (1833&nbsp;m)']);
	assert.match(html, /Approaching <span translate="no"><a class="mk-place" href="#hike-map" data-place-lat="47.41" data-place-lon="10.99"/);
	assert.match(html, /<span translate="no">Zugspitze \(2962&nbsp;m\)<\/span>/);
});

test('no place links in headings, links or figure captions', async () => {
	const md = '## Knorrhütte (2052 m)\n\n[Knorrhütte (2052 m)](/hikes/x/)\n\n![Knorrhütte (2052 m)](/images/a.jpg)\n\n[Knorrhütte (2052 m)](/404/)\n';
	const { html, media } = await parseMarkdown(body(md), [], { nodes: NODES });
	// Only the placeholder link renders as plain text, so only it can hold a place link.
	assert.deepEqual(placeLinks(html), ['Knorrhütte (2052&nbsp;m)']);
	assert.match(html, /<h2>.*Knorrhütte.*<\/h2>/);
	assert.match(html, /<a href="\/hikes\/x\/"><span translate="no">Knorrhütte \(2052&nbsp;m\)<\/span><\/a>/);
	assert.doesNotMatch(media[0].captionHtml ?? '', /mk-place/);
});

test('without nodes, references are only protected from translation', async () => {
	const { html } = await parseMarkdown(body('Up to Knorrhütte (2052 m).'), []);
	assert.deepEqual(placeLinks(html), []);
	assert.match(html, /<span translate="no">Knorrhütte \(2052&nbsp;m\)<\/span>/);
});

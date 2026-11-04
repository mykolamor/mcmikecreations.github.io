// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/place-links.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceIndex, insideTileSquare, normalizePlaceName } from './place-links';
import { findPlaceMentions, parseMarkdown } from './hikes-info';

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

test('a Czech name links too', () => {
	const snezka = { lat: 50.7, lon: 15.7, tags: { name: 'Śnieżka', 'name:cs': 'Sněžka', ele: '1603' } };
	const index = buildPlaceIndex([snezka])!;
	assert.deepEqual(index.match(['Sněžka'], 1603), { start: 0, node: snezka });
});

test('a height with decimals links like a whole one', async () => {
	const snezka = { lat: 50.7, lon: 15.7, tags: { name: 'Śnieżka / Sněžka', 'name:cs': 'Sněžka', ele: '1603.3' } };
	const { html } = await parseMarkdown(body('At the top of\nSněžka (1603.3 m), with a view, then Gipfel (1603,5 m).'), [], { nodes: [snezka] });
	assert.deepEqual(placeLinks(html), ['Sněžka (1603.3&nbsp;m)']);
});

const NEAR = { lat: 47.6, lon: 11.9, tags: { name: 'Hirschberg', ele: '1670' } };
const FAR = { lat: 47.7, lon: 11.0, tags: { name: 'Hirschberg', ele: '1511' } };
const ORIGIN = { lat: 47.62, lon: 11.88 };

test('same name: elevation first, then nearest to origin', () => {
	assert.equal(buildPlaceIndex([FAR, NEAR], { origin: ORIGIN })!.match(['Hirschberg'], 1670)!.node, NEAR);
	const other = { ...FAR, tags: { name: 'Hirschberg', ele: '1670' }, lat: 50, lon: 5 };
	assert.equal(buildPlaceIndex([other, NEAR], { origin: ORIGIN })!.match(['Hirschberg'], 1670)!.node, NEAR);
});

test('without origin, elevation still decides', () => {
	assert.equal(buildPlaceIndex([FAR, NEAR])!.match(['Hirschberg'], 1670)!.node, NEAR); // ele match preferred
});

test('re-parsing with only the matched nodes links the same places', async () => {
	const md = 'Up Hirschberg (1670 m) and Knorrhütte (2052 m).';
	const all = await parseMarkdown(md, [], { nodes: [FAR, NEAR, KNORR], origin: ORIGIN });
	const again = await parseMarkdown(md, [], { nodes: all.placeNodes, origin: ORIGIN });
	assert.equal(again.html, all.html);
	assert.equal(all.placeNodes.length, 2);
});

test('a partial name at the right height beats a whole name at another', () => {
	const vorderer = { lat: 47.66, lon: 11.5, tags: { name: 'Vorderer Kirchstein', ele: '1670' } };
	const elsewhere = { lat: 47.65, lon: 11.93, tags: { name: 'Kirchstein' } };
	const index = buildPlaceIndex([vorderer, elsewhere], { origin: { lat: 47.66, lon: 11.45 } })!;
	assert.deepEqual(index.match(['Kirchstein'], 1667), { start: 0, node: vorderer });
	// Without a height to check, the whole name still wins.
	assert.deepEqual(index.match(['Kirchstein'], NaN), { start: 0, node: elsewhere });
	// And a whole name at the right height beats a partial one.
	const atHeight = { ...elsewhere, tags: { name: 'Kirchstein', ele: '1668' } };
	assert.deepEqual(buildPlaceIndex([vorderer, atHeight])!.match(['Kirchstein'], 1667), { start: 0, node: atHeight });
});

test('the store and a subset holding the winner pick the same node', () => {
	const hinterer = { ref: 'node/1', lat: 47.66, lon: 11.49, tags: { name: 'Hinterer Kirchstein', ele: '1600' } };
	const vorderer = { ref: 'node/2', lat: 47.66, lon: 11.5, tags: { name: 'Vorderer Kirchstein', ele: '1670' } };
	const kirchstein = { ref: 'node/3', lat: 47.65, lon: 11.93, tags: { name: 'Kirchstein', ele: '1667' } };
	const origin = { lat: 47.66, lon: 11.45 };
	const words = ['Hinterer', 'Kirchstein'];
	const full = buildPlaceIndex([hinterer, vorderer, kirchstein], { origin })!.match(words, 1667);
	// A whole name at the right height ("Kirchstein", 1667 m) beats a partial one.
	assert.deepEqual(full, { start: 1, node: kirchstein });
	assert.deepEqual(buildPlaceIndex([vorderer, kirchstein], { origin })!.match(words, 1667), full);
});

test('equidistant candidates are decided by ref, not by order', () => {
	const a = { ref: 'node/10', lat: 47, lon: 11, tags: { name: 'Twin', ele: '1000' } };
	const b = { ref: 'node/20', lat: 47, lon: 11, tags: { name: 'Twin', ele: '1000' } };
	assert.equal(buildPlaceIndex([b, a])!.match(['Twin'], 1000)!.node, a);
	assert.equal(buildPlaceIndex([a, b], { origin: { lat: 46, lon: 10 } })!.match(['Twin'], 1000)!.node, a);
});

// The post's map tile square: height 512 at 47.7 N has a half side of about 3.24 km.
const SQ_ORIGIN = { lat: 47.7, lon: 11.5 };
const metresNorth = (m: number) => ({ lat: SQ_ORIGIN.lat + m / 111195, lon: SQ_ORIGIN.lon });
const metresEast = (m: number) => ({ lat: SQ_ORIGIN.lat, lon: SQ_ORIGIN.lon + m / (111195 * Math.cos((SQ_ORIGIN.lat * Math.PI) / 180)) });

test('insideTileSquare: the origin and 3.0 km north are inside, 3.4 km north is outside', () => {
	assert.equal(insideTileSquare(SQ_ORIGIN, SQ_ORIGIN, 512), true);
	assert.equal(insideTileSquare(metresNorth(3000), SQ_ORIGIN, 512), true);
	assert.equal(insideTileSquare(metresNorth(3400), SQ_ORIGIN, 512), false);
	assert.equal(insideTileSquare(metresNorth(-3400), SQ_ORIGIN, 512), false);
});

test('insideTileSquare: east and west are checked too, and a bigger height widens the square', () => {
	assert.equal(insideTileSquare(metresEast(3000), SQ_ORIGIN, 512), true);
	assert.equal(insideTileSquare(metresEast(3400), SQ_ORIGIN, 512), false);
	assert.equal(insideTileSquare(metresEast(-3400), SQ_ORIGIN, 512), false);
	assert.equal(insideTileSquare(metresEast(3400), SQ_ORIGIN, 1024), true);
});

test('a node outside the tile square is neither indexed nor a candidate', () => {
	const near = { ...metresNorth(1000), tags: { name: 'Nahberg', ele: '1000' } };
	const far = { ...metresNorth(3400), tags: { name: 'Fernberg', ele: '1000' } };
	assert.equal(buildPlaceIndex([near, far], { origin: SQ_ORIGIN, height: 512 })!.match(['Fernberg'], 1000), null);
	assert.equal(buildPlaceIndex([near, far], { origin: SQ_ORIGIN, height: 512 })!.match(['Nahberg'], 1000)!.node, near);
	// Without a height (or an origin) nothing is cut.
	assert.equal(buildPlaceIndex([near, far], { origin: SQ_ORIGIN })!.match(['Fernberg'], 1000)!.node, far);
	assert.equal(buildPlaceIndex([near, far], { height: 512 })!.match(['Fernberg'], 1000)!.node, far);
	// A name present only outside leaves no index at all.
	assert.equal(buildPlaceIndex([far], { origin: SQ_ORIGIN, height: 512 }), null);
});

test('a far duplicate of a name never wins, even by elevation', () => {
	const near = { ...metresNorth(1000), tags: { name: 'Zwilling', ele: '1150' } };
	const far = { ...metresNorth(3400), tags: { name: 'Zwilling', ele: '1200' } };
	const index = buildPlaceIndex([near, far], { origin: SQ_ORIGIN, height: 512 })!;
	assert.equal(index.match(['Zwilling'], 1200)!.node, near);
});

test('a mention of a far node does not link, a near one does, and a subset re-parse agrees', async () => {
	const near = { ...metresNorth(1000), tags: { name: 'Nahberg', ele: '1000' } };
	const far = { ...metresNorth(3400), tags: { name: 'Fernberg', ele: '1100' } };
	const md = 'Up Nahberg (1000 m) and Fernberg (1100 m).';
	const all = await parseMarkdown(body(md), [], { nodes: [near, far], origin: SQ_ORIGIN, height: 512 });
	assert.equal(all.html.includes('Nahberg (1000&nbsp;m)</a>'), true);
	assert.equal(all.html.includes('Fernberg (1100&nbsp;m)</a>'), false);
	assert.equal(all.placeNodes.length, 1);
	const again = await parseMarkdown(body(md), [], { nodes: all.placeNodes, origin: SQ_ORIGIN, height: 512 });
	assert.equal(again.html, all.html);
});

test('the hike\'s own nodes link outside the square, other far nodes do not, and a subset re-parse agrees', async () => {
	const own = { ref: 'node/1', ...metresNorth(5000), tags: { name: 'Eigenberg', ele: '1000' } };
	const other = { ref: 'node/2', ...metresNorth(5000), tags: { name: 'Fremdberg', ele: '1100' } };
	const md = 'Up Eigenberg (1000 m) and Fremdberg (1100 m).';
	const opts = { origin: SQ_ORIGIN, height: 512, ownRefs: ['node/1'] };
	const all = await parseMarkdown(body(md), [], { nodes: [own, other], ...opts });
	assert.equal(all.html.includes('Eigenberg (1000&nbsp;m)</a>'), true);
	assert.equal(all.html.includes('Fremdberg (1100&nbsp;m)</a>'), false);
	const again = await parseMarkdown(body(md), [], { nodes: all.placeNodes, ...opts });
	assert.equal(again.html, all.html);
	assert.equal(buildPlaceIndex([own], { origin: SQ_ORIGIN, height: 512 }), null);
	assert.equal(buildPlaceIndex([own], { origin: SQ_ORIGIN, height: 512, keepRefs: ['node/1'] })!.match(['Eigenberg'], 1000)!.node, own);
});

test('an exact name at a clearly different height is another place, with no height it still links', () => {
	const far = { ref: 'node/1', ...metresNorth(5000), tags: { name: 'Brauneck', ele: '1555' } };
	const near = { ref: 'node/2', ...metresNorth(1000), tags: { name: 'Brauneck', ele: '1290' } };
	const bare = { ref: 'node/3', ...metresNorth(1000), tags: { name: 'Hoherkamm' } };
	const typo = { ref: 'node/4', ...metresNorth(1000), tags: { name: 'Tippfehler', ele: '1667' } };
	const opts = { origin: SQ_ORIGIN, height: 512 };
	// The real 1555 m node is cut off; the 1290 m one must not stand in for it.
	assert.equal(buildPlaceIndex([far, near], opts)!.match(['Brauneck'], 1555), null);
	assert.equal(buildPlaceIndex([near], opts)!.match(['Brauneck'], 1555), null);
	assert.equal(buildPlaceIndex([far, near], opts)!.match(['Brauneck'], 1290)!.node, near);
	assert.equal(buildPlaceIndex([near], opts)!.match(['Brauneck'], 1290)!.node, near);
	// No height on the node: any reference height links.
	assert.equal(buildPlaceIndex([bare], opts)!.match(['Hoherkamm'], 2500)!.node, bare);
	// A reference without a height (NaN) takes any node.
	assert.equal(buildPlaceIndex([near], opts)!.match(['Brauneck'], NaN)!.node, near);
	// A rounding or typo difference (within 100 m) still links.
	assert.equal(buildPlaceIndex([typo], opts)!.match(['Tippfehler'], 1700)!.node, typo);
	assert.equal(buildPlaceIndex([typo], opts)!.match(['Tippfehler'], 1800), null);
});

test('findPlaceMentions gives what the renderer links, as offsets into the text', () => {
	const text = 'Tea & "cake" approaching Knorrhütte (2052 m), then Zugspitze (2962 m). The Hoher Kalmberg (1833 m).';
	const mentions = findPlaceMentions(text, places);
	assert.deepEqual(mentions.map(({ from, to, node }) => [text.slice(from, to), node]), [
		['Knorrhütte (2052 m)', KNORR],
		['Hoher Kalmberg (1833 m)', KALMBERG]
	]);
	assert.deepEqual(findPlaceMentions(text, null), []);
});

test('a place mention in a fixture string still links after extracting findPlaceMentions', async () => {
	const text = 'Tea & "cake", approaching Knorrhütte (2052 m), then Zugspitze (2962 m). After Hoher Kalmberg (1833 m), Tovre (1913 m).';
	const { html } = await parseMarkdown(body(text + '\n'), [], { nodes: NODES });
	const linked = placeLinks(html).map((t) => t.replace(/&nbsp;/g, ' '));
	assert.deepEqual(linked, ['Knorrhütte (2052 m)', 'Hoher Kalmberg (1833 m)', 'Tovre (1913 m)']);
	assert.deepEqual(findPlaceMentions(text, places).map(({ from, to }) => text.slice(from, to)), linked);
});

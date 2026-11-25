// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/place-links.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceIndex } from './place-links';
import { findPlaceMentions, parseMarkdown } from './hikes-info';

const KNORR = { lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte', ele: '2052' } };
const KIRCHSTEIN = { lat: 47.6, lon: 11.5, tags: { name: 'Vorderer Kirchstein' } };
const KALMBERG = { lat: 47.6, lon: 13.6, tags: { name: 'Hoher Kalmberg', 'name:de': 'Kalmberg' } };
const TOVRE = { lat: 46.2, lon: 12.1, tags: { name: 'Palon de Tovre', ele: '1913 m' } };
const NODES = [KNORR, KIRCHSTEIN, KALMBERG, TOVRE, { lat: 1, lon: 1, tags: { natural: 'peak' } }];
const places = buildPlaceIndex(NODES)!;

test('names match loosely by trailing whole words, the longest match winning', () => {
	// Leading words are left out; case, accents, ß, hyphens and spaces inside a name don't matter.
	assert.deepEqual(places.match(['Approaching', 'Knorrhütte'], 2052), { start: 1, node: KNORR });
	assert.deepEqual(places.match(['Vorderer-Kirchstein'], 1670), { start: 0, node: KIRCHSTEIN });
	assert.deepEqual(places.match(['Vordererkirchstein'], 1670), { start: 0, node: KIRCHSTEIN });
	const auer = buildPlaceIndex([{ lat: 1, lon: 2, tags: { name: 'Auerberg', ele: '1055' } }])!;
	assert.equal(auer.match(['Auer', 'Berg'], 1055)?.start, 0);
	assert.equal(buildPlaceIndex([{ lat: 1, lon: 2, tags: { name: 'Roßkopf' } }])!.match(['ROSSKOPF'], NaN)?.start, 0);
	assert.deepEqual(places.match(['Face-shaped', 'Hoher', 'Kalmberg'], 1833), { start: 1, node: KALMBERG });
	// A node name ending in the reference matches only at the same height, and only by whole words.
	assert.deepEqual(places.match(['Tovre'], 1910), { start: 0, node: TOVRE });
	assert.deepEqual(places.match(['Detovre'], 1913), { start: 0, node: TOVRE });
	assert.equal(places.match(['Tovre'], 1700), null);
	assert.equal(places.match(['Ovre'], 1913), null);
	assert.equal(places.match(['Rchstein'], 1670), null);
	// Translated names link too.
	const hoverla = { lat: 48.16, lon: 24.5, tags: { name: 'Hoverla', 'name:uk': 'Говерла', ele: '2061' } };
	assert.deepEqual(buildPlaceIndex([hoverla])!.match(['Говерла'], 2061), { start: 0, node: hoverla });
	assert.equal(buildPlaceIndex([{ lat: 1, lon: 1, tags: { natural: 'peak' } }]), null);
});

test('of several candidates: elevation first, then a whole name, then nearest, then ref', () => {
	const near = { lat: 47.6, lon: 11.9, tags: { name: 'Hirschberg', ele: '1670' } };
	const far = { lat: 47.7, lon: 11.0, tags: { name: 'Hirschberg', ele: '1511' } };
	const origin = { lat: 47.62, lon: 11.88 };
	assert.equal(buildPlaceIndex([far, near])!.match(['Hirschberg'], 1670)!.node, near);
	const farSame = { ...far, tags: { name: 'Hirschberg', ele: '1670' }, lat: 50, lon: 5 };
	assert.equal(buildPlaceIndex([farSame, near], { origin })!.match(['Hirschberg'], 1670)!.node, near);
	// A partial name at the right height beats a whole name at another; without a height the whole name wins.
	const vorderer = { lat: 47.66, lon: 11.5, tags: { name: 'Vorderer Kirchstein', ele: '1670' } };
	const elsewhere = { lat: 47.65, lon: 11.93, tags: { name: 'Kirchstein' } };
	const index = buildPlaceIndex([vorderer, elsewhere], { origin: { lat: 47.66, lon: 11.45 } })!;
	assert.deepEqual(index.match(['Kirchstein'], 1667), { start: 0, node: vorderer });
	assert.deepEqual(index.match(['Kirchstein'], NaN), { start: 0, node: elsewhere });
	// A whole name at the right height beats a partial one, and the store and a subset holding the winner agree.
	const hinterer = { ref: 'node/1', lat: 47.66, lon: 11.49, tags: { name: 'Hinterer Kirchstein', ele: '1600' } };
	const kirchstein = { ref: 'node/3', lat: 47.65, lon: 11.93, tags: { name: 'Kirchstein', ele: '1667' } };
	const words = ['Hinterer', 'Kirchstein'];
	const full = buildPlaceIndex([hinterer, { ...vorderer, ref: 'node/2' }, kirchstein], { origin })!.match(words, 1667);
	assert.deepEqual(full, { start: 1, node: kirchstein });
	assert.deepEqual(buildPlaceIndex([{ ...vorderer, ref: 'node/2' }, kirchstein], { origin })!.match(words, 1667), full);
	// Equidistant candidates are decided by ref, not by order.
	const a = { ref: 'node/10', lat: 47, lon: 11, tags: { name: 'Twin', ele: '1000' } };
	const b = { ref: 'node/20', lat: 47, lon: 11, tags: { name: 'Twin', ele: '1000' } };
	assert.equal(buildPlaceIndex([b, a])!.match(['Twin'], 1000)!.node, a);
	assert.equal(buildPlaceIndex([a, b], { origin: { lat: 46, lon: 10 } })!.match(['Twin'], 1000)!.node, a);
});

// The post's map tile square: height 512 at 47.7 N has a half side of about 3.24 km.
const SQ_ORIGIN = { lat: 47.7, lon: 11.5 };
const SQUARE = { origin: SQ_ORIGIN, height: 512 };
const metresNorth = (m: number) => ({ lat: SQ_ORIGIN.lat + m / 111195, lon: SQ_ORIGIN.lon });
const metresEast = (m: number) => ({ lat: SQ_ORIGIN.lat, lon: SQ_ORIGIN.lon + m / (111195 * Math.cos((SQ_ORIGIN.lat * Math.PI) / 180)) });

test('a node outside the tile square is neither indexed nor a candidate, even by elevation', () => {
	const near = { ...metresNorth(1000), tags: { name: 'Nahberg', ele: '1000' } };
	const far = { ...metresNorth(3400), tags: { name: 'Fernberg', ele: '1000' } };
	const east = { ...metresEast(3400), tags: { name: 'Ostberg', ele: '1000' } };
	const index = buildPlaceIndex([near, far, east], SQUARE)!;
	assert.equal(index.match(['Nahberg'], 1000)!.node, near);
	assert.equal(index.match(['Fernberg'], 1000), null);
	assert.equal(index.match(['Ostberg'], 1000), null);
	// A bigger height widens the square; without a height (or an origin) nothing is cut.
	assert.equal(buildPlaceIndex([east], { origin: SQ_ORIGIN, height: 1024 })!.match(['Ostberg'], 1000)!.node, east);
	assert.equal(buildPlaceIndex([near, far], { origin: SQ_ORIGIN })!.match(['Fernberg'], 1000)!.node, far);
	assert.equal(buildPlaceIndex([near, far], { height: 512 })!.match(['Fernberg'], 1000)!.node, far);
	assert.equal(buildPlaceIndex([far], SQUARE), null);
	// A far duplicate of a name never wins, even by elevation.
	const twin = { ...metresNorth(1000), tags: { name: 'Zwilling', ele: '1150' } };
	const farTwin = { ...metresNorth(3400), tags: { name: 'Zwilling', ele: '1200' } };
	assert.equal(buildPlaceIndex([twin, farTwin], SQUARE)!.match(['Zwilling'], 1200)!.node, twin);
});

test('an exact name at a clearly different height is another place; with no height it still links', () => {
	const far = { ref: 'node/1', ...metresNorth(5000), tags: { name: 'Brauneck', ele: '1555' } };
	const near = { ref: 'node/2', ...metresNorth(1000), tags: { name: 'Brauneck', ele: '1290' } };
	const bare = { ref: 'node/3', ...metresNorth(1000), tags: { name: 'Hoherkamm' } };
	const typo = { ref: 'node/4', ...metresNorth(1000), tags: { name: 'Tippfehler', ele: '1667' } };
	// The real 1555 m node is cut off; the 1290 m one must not stand in for it.
	assert.equal(buildPlaceIndex([far, near], SQUARE)!.match(['Brauneck'], 1555), null);
	assert.equal(buildPlaceIndex([far, near], SQUARE)!.match(['Brauneck'], 1290)!.node, near);
	// No height on the node, or none in the reference: any height links.
	assert.equal(buildPlaceIndex([bare], SQUARE)!.match(['Hoherkamm'], 2500)!.node, bare);
	assert.equal(buildPlaceIndex([near], SQUARE)!.match(['Brauneck'], NaN)!.node, near);
	// A rounding or typo difference (within 100 m) still links.
	assert.equal(buildPlaceIndex([typo], SQUARE)!.match(['Tippfehler'], 1700)!.node, typo);
	assert.equal(buildPlaceIndex([typo], SQUARE)!.match(['Tippfehler'], 1800), null);
});

const body = (md: string) => '---\ntitle: T\n---\n' + md;
const placeLinks = (html: string) => [...html.matchAll(/<a class="mk-place" href="#hike-map"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

test('prose references link to the map with the node position; others are protected from translation', async () => {
	const md = 'Approaching Knorrhütte (2052 m), then Zugspitze (2962 m).\n\n- Past Hoher Kalmberg (1833 m)\n\nЧерез Knorrhütte (2052 м).\n';
	const { html } = await parseMarkdown(body(md), [], { nodes: NODES });
	assert.deepEqual(placeLinks(html), ['Knorrhütte (2052&nbsp;m)', 'Hoher Kalmberg (1833&nbsp;m)', 'Knorrhütte (2052&nbsp;м)']);
	assert.match(html, /Approaching <span translate="no"><a class="mk-place" href="#hike-map" data-place-lat="47.41" data-place-lon="10.99"/);
	assert.match(html, /<span translate="no">Zugspitze \(2962&nbsp;m\)<\/span>/);
	// A height with decimals links like a whole one.
	const snezka = { lat: 50.7, lon: 15.7, tags: { name: 'Śnieżka / Sněžka', 'name:cs': 'Sněžka', ele: '1603.3' } };
	const decimals = await parseMarkdown(body('At the top of\nSněžka (1603.3 m), with a view, then Gipfel (1603,5 m).'), [], { nodes: [snezka] });
	assert.deepEqual(placeLinks(decimals.html), ['Sněžka (1603.3&nbsp;m)']);
	// Without nodes, references are only protected.
	const plain = await parseMarkdown(body('Up to Knorrhütte (2052 m).'), []);
	assert.deepEqual(placeLinks(plain.html), []);
	assert.match(plain.html, /<span translate="no">Knorrhütte \(2052&nbsp;m\)<\/span>/);
});

test('no place links in headings, links or figure captions', async () => {
	const md = '## Knorrhütte (2052 m)\n\n[Knorrhütte (2052 m)](/hikes/x/)\n\n![Knorrhütte (2052 m)](/images/a.jpg)\n\n[Knorrhütte (2052 m)](/404/)\n';
	const { html, media } = await parseMarkdown(body(md), [], { nodes: NODES });
	// Only the placeholder link renders as plain text, so only it can hold a place link.
	assert.deepEqual(placeLinks(html), ['Knorrhütte (2052&nbsp;m)']);
	assert.match(html, /<a href="\/hikes\/x\/"><span translate="no">Knorrhütte \(2052&nbsp;m\)<\/span><\/a>/);
	assert.doesNotMatch(media[0].captionHtml ?? '', /mk-place/);
});

test('a placeholder image renders nothing, so prerender never fetches /404/', async () => {
	const { html, media } = await parseMarkdown(body('Before.\n\n![Full via ferrata climb](/404/)\n\nAfter.\n'), []);
	assert.doesNotMatch(html, /404/);
	assert.doesNotMatch(html, /<p>\s*<\/p>/);
	assert.equal(media.length, 0);
});

test('re-parsing with only the matched nodes links the same places', async () => {
	const near = { ...metresNorth(1000), tags: { name: 'Nahberg', ele: '1000' } };
	const far = { ...metresNorth(3400), tags: { name: 'Fernberg', ele: '1100' } };
	// The hike's own nodes link outside the square, other far nodes do not.
	const own = { ref: 'node/1', ...metresNorth(5000), tags: { name: 'Eigenberg', ele: '1000' } };
	const other = { ref: 'node/2', ...metresNorth(5000), tags: { name: 'Fremdberg', ele: '1100' } };
	const md = body('Up Nahberg (1000 m), Fernberg (1100 m), Eigenberg (1000 m) and Fremdberg (1100 m).');
	const opts = { ...SQUARE, ownRefs: ['node/1'] };
	const all = await parseMarkdown(md, [], { nodes: [near, far, own, other], ...opts });
	assert.deepEqual(placeLinks(all.html), ['Nahberg (1000&nbsp;m)', 'Eigenberg (1000&nbsp;m)']);
	assert.equal(all.placeNodes.length, 2);
	const again = await parseMarkdown(md, [], { nodes: all.placeNodes, ...opts });
	assert.equal(again.html, all.html);
	assert.equal(buildPlaceIndex([own], SQUARE), null);
	assert.equal(buildPlaceIndex([own], { ...SQUARE, keepRefs: ['node/1'] })!.match(['Eigenberg'], 1000)!.node, own);
});

test('findPlaceMentions gives what the renderer links, as offsets into the text', async () => {
	const text = 'Tea & "cake", approaching Knorrhütte (2052 m), then Zugspitze (2962 m). After Hoher Kalmberg (1833 m), Tovre (1913 m).';
	const { html } = await parseMarkdown(body(text + '\n'), [], { nodes: NODES });
	const linked = placeLinks(html).map((t) => t.replace(/&nbsp;/g, ' '));
	assert.deepEqual(linked, ['Knorrhütte (2052 m)', 'Hoher Kalmberg (1833 m)', 'Tovre (1913 m)']);
	assert.deepEqual(findPlaceMentions(text, places).map(({ from, to }) => text.slice(from, to)), linked);
	assert.equal(findPlaceMentions(text, places)[0].node, KNORR);
	assert.deepEqual(findPlaceMentions(text, null), []);
});

// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/photo-pins-view.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoPinsHtml } from './photo-pins-view';
import { parseMarkdown } from './hikes-info';
import type { PinNode } from './photo-pins';

const ZUGSPITZE: PinNode = { ref: 'node/1', lat: 47.42, lon: 10.98, tags: { name: 'Zugspitze', ele: '2962' } };
const HUT: PinNode = { ref: 'way/5', lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte' } };
const NODES = { 'node/1': ZUGSPITZE, 'way/5': HUT };

test('a pin is a positioned button labelled with name and height', () => {
	const html = photoPinsHtml([{ ref: 'node/1', x: 0.5213, y: 0.1702 }], NODES);
	assert.match(html, /^<span class="mk-photo-pins">/);
	assert.match(html, /<button type="button" class="mk-photo-pin" data-pin-ref="node\/1" style="left:52\.13%;top:17\.02%" aria-label="Zugspitze, 2962 m">/);
});

test('no height, no height in the label', () => {
	assert.match(photoPinsHtml([{ ref: 'way/5', x: 0, y: 1 }], NODES), /aria-label="Knorrhütte"/);
});

test('unknown refs are skipped and nothing to draw gives nothing', () => {
	assert.equal(photoPinsHtml([{ ref: 'node/9', x: 0.5, y: 0.5 }], NODES), '');
	assert.equal(photoPinsHtml(undefined, NODES), '');
	assert.equal(photoPinsHtml([{ ref: 'node/1', x: 0.5, y: 0.5 }], undefined), '');
});

test('names are escaped', () => {
	const odd: PinNode = { ref: 'node/2', lat: 0, lon: 0, tags: { name: 'A "B" <C>' } };
	assert.match(photoPinsHtml([{ ref: 'node/2', x: 0, y: 0 }], { 'node/2': odd }), /aria-label="A &quot;B&quot; &lt;C&gt;"/);
});

const post = (meta: string) =>
	`---\ntitle: T\nimages:\n  a.jpg: {w: 4000, h: 3000, ${meta}pins: [{ref: node/1, x: 0.5, y: 0.25}]}\n---\n` +
	'Up to the top.\n\n![View to Zugspitze (2962 m)](/images/projects/data-viz/hikes/stories/x/a.jpg)\n';

test('the post renders pins inside the image shell and lists them on the media item', async () => {
	const { html, media } = await parseMarkdown(post("blur: 'data:image/webp;base64,AA', "), [], { pinNodes: NODES });
	const shell = /<span class="mk-img-shell"[\s\S]*?<\/picture>\s*(<span class="mk-photo-pins">[\s\S]*?<\/span>)\s*<\/span>/.exec(html);
	assert.ok(shell, 'pins sit inside the shell, after the picture');
	assert.equal((shell![1].match(/mk-photo-pin"/g) ?? []).length, 1);
	assert.equal(media[0].kind === 'image' && media[0].pins?.length, 1);
	// The pin's name is not turned into a place link.
	assert.doesNotMatch(shell![1], /mk-place/);
});

test('a fallback image (no AVIF tiers) with pins gets a frame that fits it, with the pins inside', async () => {
	const { html, media } = await parseMarkdown(post(''), [], { pinNodes: NODES });
	const frame = /<span class="mk-img-frame">\s*<img [^>]*width="4000" height="3000"[^>]*\/>\s*(<span class="mk-photo-pins">[\s\S]*?<\/span>)\s*<\/span>/.exec(html);
	assert.ok(frame, 'pins sit in a frame around the image');
	assert.equal((frame![1].match(/class="mk-photo-pin"/g) ?? []).length, 1);
	assert.equal(media[0].kind === 'image' && media[0].pins?.length, 1);
});

test('a fallback image without pins is rendered as before, with no frame', async () => {
	const md = '---\ntitle: T\nimages:\n  a.jpg: {w: 4000, h: 3000}\n---\n![V](/images/hikes/topo/a.jpg)\n';
	const { html, media } = await parseMarkdown(md, [], { pinNodes: NODES });
	assert.doesNotMatch(html, /mk-img-frame"|class="mk-photo-pin/);
	assert.equal(media[0].kind === 'image' && 'pins' in media[0], false);
});

test('an image with no front matter entry has nowhere to keep pins', async () => {
	const { html } = await parseMarkdown('---\ntitle: T\n---\n![V](/images/hikes/topo/x.jpg)\n', [], { pinNodes: NODES });
	assert.doesNotMatch(html, /mk-img-frame"|class="mk-photo-pin/);
});

test('client re-parse renders the same pins', async () => {
	const md = post("blur: 'data:image/webp;base64,AA', ");
	const a = await parseMarkdown(md, [], { pinNodes: NODES });
	const b = await parseMarkdown(md, [], { pinNodes: NODES });
	const pins = (html: string) => html.match(/<span class="mk-photo-pins">[\s\S]*?<\/span>/)?.[0];
	assert.ok(pins(a.html));
	assert.equal(pins(a.html), pins(b.html));
});

test('the styles hide pins until the script has wired them', async () => {
	const { html } = await parseMarkdown(post("blur: 'data:image/webp;base64,AA', "), [], { pinNodes: NODES });
	assert.match(html, /\.mk-photo-pins\s*\{[^}]*display:\s*none/);
	assert.match(html, /\.mk-photo-pins-ready \.mk-photo-pins\s*\{[^}]*display:\s*block/);
});

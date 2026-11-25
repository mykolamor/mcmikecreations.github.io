// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/photo-pins-view.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoPinsHtml } from './photo-pins-view';
import { parseMarkdown } from './hikes-info';
import type { PinNode } from './photo-pins';

const ZUGSPITZE: PinNode = { ref: 'node/1', lat: 47.42, lon: 10.98, tags: { name: 'Zugspitze', ele: '2962' } };
const HUT: PinNode = { ref: 'way/5', lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte' } };
const NODES = { 'node/1': ZUGSPITZE, 'way/5': HUT };

test('a pin is a positioned button labelled with name and height, escaped; unknown refs are skipped', () => {
	const html = photoPinsHtml([{ ref: 'node/1', x: 0.5213, y: 0.1702 }, { ref: 'way/5', x: 0, y: 1 }, { ref: 'node/9', x: 0.5, y: 0.5 }], NODES);
	assert.match(html, /^<span class="mk-photo-pins">/);
	assert.match(html, /<button type="button" class="mk-photo-pin" data-pin-ref="node\/1" style="left:52\.13%;top:17\.02%" aria-label="Zugspitze, 2962 m">/);
	assert.match(html, /aria-label="Knorrhütte"/);
	assert.equal((html.match(/class="mk-photo-pin"/g) ?? []).length, 2);
	assert.equal(photoPinsHtml([{ ref: 'node/9', x: 0.5, y: 0.5 }], NODES), '');
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
	// Without pins it gets no frame.
	const bare = await parseMarkdown('---\ntitle: T\nimages:\n  a.jpg: {w: 4000, h: 3000}\n---\n![V](/images/hikes/topo/a.jpg)\n', [], { pinNodes: NODES });
	assert.doesNotMatch(bare.html, /mk-img-frame"|class="mk-photo-pin/);
});


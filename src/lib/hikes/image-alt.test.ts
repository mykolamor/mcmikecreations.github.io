// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/image-alt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from './hikes-info';

const post = (extra: string) => `---
title: T
images:
  a.jpg: {w: 4000, h: 3000, blur: 'data:image/webp;base64,AA'${extra}}
  b.png: {w: 400, h: 300${extra}}
---
![The ridge at dawn](/x/a.jpg)

![A "quoted" topo](/x/b.png)
`;

test('the images alt replaces the caption as the alt attribute, escaped; without one the caption stays', async () => {
	const { html, media } = await parseMarkdown(post(", alt: 'Sunlit ridge with a \"cross\"'"), []);
	assert.equal(html.match(/alt="Sunlit ridge with a &quot;cross&quot;"/g)?.length, 2);
	assert.match(html, /<figcaption class="mk-figcaption">The ridge at dawn/);
	assert.deepEqual(media.map((m: any) => m.alt), ['Sunlit ridge with a "cross"', 'Sunlit ridge with a "cross"']);
	const plain = await parseMarkdown(post(''), []);
	assert.match(plain.html, /alt="The ridge at dawn"/);
	assert.deepEqual(plain.media.map((m: any) => m.alt), ['The ridge at dawn', 'A "quoted" topo']);
});

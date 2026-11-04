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

test('renderer uses images alt when present', async () => {
	const { html, media } = await parseMarkdown(post(", alt: 'Sunlit ridge with a \"cross\"'"), []);
	assert.match(html, /alt="Sunlit ridge with a &quot;cross&quot;"/);
	assert.equal(html.match(/alt="Sunlit ridge with a &quot;cross&quot;"/g)?.length, 2);
	assert.match(html, /<figcaption class="mk-figcaption">The ridge at dawn/);
	assert.deepEqual(media.map((m: any) => m.alt), ['Sunlit ridge with a "cross"', 'Sunlit ridge with a "cross"']);
});

test('without images alt the caption text stays the alt attribute', async () => {
	const { html, media } = await parseMarkdown(post(''), []);
	assert.match(html, /alt="The ridge at dawn"/);
	assert.deepEqual(media.map((m: any) => m.alt), ['The ridge at dawn', 'A "quoted" topo']);
});

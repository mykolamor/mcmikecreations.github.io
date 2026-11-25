// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/header-image.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexHeaderImages, headerPictureFrom } from './header-image';

const HREF = '/images/projects/data-viz/hikes/foo.jpg';
const META = { w: 8160, h: 6120, blur: 'data:image/webp;base64,x' };

test('a header image with tiers and a blur becomes a picture; anything else gives none', () => {
	const index = indexHeaderImages([
		{ images: { [HREF]: META, '2024-01-01-00.jpg': { w: 1, h: 1, blur: 'b' } } },
		{ title: 'no images' },
		{ images: { '/images/projects/data-viz/hikes/bar.jpg': { w: 10, h: 10 } } }
	]);
	// Full-href entries of every post, not the per-post photo keys.
	assert.deepEqual([...index.keys()], [HREF]);
	const picture = headerPictureFrom(HREF, index);
	assert.ok(picture);
	assert.equal(picture.srcset, `${HREF.replace('.jpg', '-640.avif')} 640w, ${HREF.replace('.jpg', '-1280.avif')} 1280w, ${HREF.replace('.jpg', '-2560.avif')} 2560w`);
	assert.equal(picture.largest, HREF.replace('.jpg', '-2560.avif'));
	assert.equal(picture.blur, META.blur);
	// No blur, no entry, or no href.
	assert.equal(headerPictureFrom(HREF, indexHeaderImages([{ images: { [HREF]: { w: 8160, h: 6120 } } }])), null);
	assert.equal(headerPictureFrom('/images/projects/data-viz/hikes/other.jpg', index), null);
	assert.equal(headerPictureFrom(undefined, index), null);
});

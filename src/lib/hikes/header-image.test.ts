// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/header-image.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroSizes, indexHeaderImages, headerPictureFrom } from './header-image';

const HREF = '/images/projects/data-viz/hikes/foo.jpg';
const META = { w: 8160, h: 6120, blur: 'data:image/webp;base64,x' };

test('the index holds full-href entries of every post, not the per-post photo keys', () => {
	const index = indexHeaderImages([
		{ images: { [HREF]: META, '2024-01-01-00.jpg': { w: 1, h: 1, blur: 'b' } } },
		{ title: 'no images' },
		{ images: { '/images/projects/data-viz/hikes/bar.jpg': { w: 10, h: 10 } } }
	]);
	assert.deepEqual([...index.keys()], [HREF]);
});

test('a header image with tiers becomes a picture with the largest tier for the gallery', () => {
	const picture = headerPictureFrom(HREF, indexHeaderImages([{ images: { [HREF]: META } }]));
	assert.ok(picture);
	assert.equal(picture.srcset, `${HREF.replace('.jpg', '-640.avif')} 640w, ${HREF.replace('.jpg', '-1280.avif')} 1280w, ${HREF.replace('.jpg', '-2560.avif')} 2560w`);
	assert.equal(picture.largest, HREF.replace('.jpg', '-2560.avif'));
	assert.equal(picture.width, 8160);
	assert.equal(picture.blur, META.blur);
});

test('no entry, no blur or no href: no picture', () => {
	const index = indexHeaderImages([{ images: { [HREF]: { w: 8160, h: 6120 } } }]);
	assert.equal(headerPictureFrom(HREF, index), null);
	assert.equal(headerPictureFrom('/images/projects/data-viz/hikes/other.jpg', index), null);
	assert.equal(headerPictureFrom(undefined, index), null);
});

test('the hero sizes cover its box: wider than the screen on a phone, by the photo\'s shape', () => {
	assert.equal(
		heroSizes(4000, 3000),
		'(max-width: 767px) max(100vw, calc(85svh * 1.333)), max(100vw, calc(min(80svh, 52rem) * 1.333))'
	);
	assert.match(heroSizes(3000, 4000), /calc\(85svh \* 0\.75\)/);
});

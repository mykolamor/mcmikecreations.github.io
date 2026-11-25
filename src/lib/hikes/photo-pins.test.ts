// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/photo-pins.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImagePins, resolvePinNodes } from './photo-pins';

const SRC = '/_projects/data-viz/hikes/markdown/2026-07-19-x.md';

test('well-formed pins are read per image, pinsReview lands in review', () => {
	const { pins, review } = readImagePins(
		{ 'a.jpg': { w: 4, h: 3, pins: [{ ref: 'node/1', x: 0.5, y: 0 }] }, 'b.jpg': { w: 4, h: 3 } },
		SRC
	);
	assert.deepEqual(pins, { 'a.jpg': [{ ref: 'node/1', x: 0.5, y: 0 }] });
	assert.deepEqual(review, []);
	assert.deepEqual(readImagePins({ 'a.jpg': { w: 4, h: 3, pinsReview: true, pins: [] } }, SRC).review, ['a.jpg']);
});

test('malformed pins fail, naming the post and the image', () => {
	const bad = [
		{ ref: 'node/1', x: 1.2, y: 0 },
		{ ref: 'peak/1', x: 0.5, y: 0.5 },
		{ x: 0.5, y: 0.5 },
		{ ref: 'node/1', x: '0.5', y: 0.5 }
	];
	for (const pin of bad) {
		assert.throws(() => readImagePins({ 'a.jpg': { w: 4, h: 3, pins: [pin] } }, SRC), (e: Error) =>
			e.message.includes(SRC) && e.message.includes('a.jpg'));
	}
	assert.throws(() => readImagePins({ 'a.jpg': { pins: 'nope' } }, SRC), /a\.jpg/);
});

test('resolvePinNodes resolves every pinned ref, warns about review and fails on a missing one', () => {
	const store = {
		'way/5': { lat: 47.1, lon: 11.2, local: { visited: 'yes' }, tags: { name: 'Hut' }, fetched: '2026-10-26' },
		'node/1': { lat: 47.3, lon: 11.4, tags: { name: 'Peak', ele: '2000' }, fetched: '2026-10-26' }
	};
	const warnings: string[] = [];
	const nodes = resolvePinNodes(
		[
			{ data: { images: { 'a.jpg': { pins: [{ ref: 'way/5', x: 0.1, y: 0.2 }], pinsReview: true } } }, source: 'post.md' },
			{ data: { images: { 'p.jpg': { pins: [{ ref: 'node/1', x: 0.3, y: 0.4 }] } } }, source: 'place.md' },
			{ data: {}, source: 'empty.md' }
		],
		store,
		(w) => warnings.push(w)
	);
	assert.deepEqual(nodes, {
		'way/5': { ref: 'way/5', lat: 47.1, lon: 11.2, tags: { name: 'Hut', visited: 'yes' } },
		'node/1': { ref: 'node/1', lat: 47.3, lon: 11.4, tags: { name: 'Peak', ele: '2000' } }
	});
	assert.deepEqual(warnings, ['post.md: image a.jpg: pins need review (the photo changed shape since they were placed)']);
	assert.throws(
		() => resolvePinNodes([{ data: { images: { 'a.jpg': { pins: [{ ref: 'node/9', x: 0, y: 0 }] } } }, source: 'post.md' }], {}, () => {}),
		/post\.md: unknown OSM element node\/9/
	);
});


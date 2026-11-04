import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMetaFor } from './image-meta';

const images = { '2025-05-11-00.jpg': { w: 1, h: 1 }, '/images/hikes/topo/buchstein.jpg': { w: 2, h: 2 } } as never;

test('full path wins, basename still works', () => {
	assert.equal(imageMetaFor(images, '/images/hikes/topo/buchstein.jpg')?.w, 2);
	assert.equal(imageMetaFor(images, '/images/projects/data-viz/hikes/stories/buchstein/2025-05-11-00.jpg')?.w, 1);
	assert.equal(imageMetaFor(images, '/images/x/none.jpg'), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitRun, groupLines, type Word } from './text-layer';

const word = (start: number, end: number, x: number, y: number, w: number, h = 40): Word => ({ start, end, x, y, w, h });

test('groupLines joins words on one line and breaks where the text wraps or drops', () => {
	assert.deepEqual(
		groupLines('Fused  kernels win', [word(0, 5, 100, 200, 90), word(7, 14, 200, 202, 120), word(15, 18, 330, 200, 50)]),
		[{ text: 'Fused kernels win', x: 100, y: 200, w: 280, h: 42 }]
	);
	const wrapped = groupLines('one two three', [word(0, 3, 100, 100, 60), word(4, 7, 170, 100, 60), word(8, 13, 100, 150, 90)]);
	assert.deepEqual(wrapped.map((r) => [r.text, r.x, r.y]), [['one two', 100, 100], ['three', 100, 150]]);
	assert.equal(groupLines('a b', [word(0, 1, 100, 100, 20), word(2, 3, 300, 160, 20)]).length, 2);
	// A word without a box is skipped.
	assert.deepEqual(groupLines('a b', [word(0, 1, 0, 0, 0), word(2, 3, 10, 10, 20)]).map((r) => r.text), ['b']);
});

test('fitRun keeps scale 1 for text it cannot measure', () => {
	assert.equal(fitRun({ text: '', x: 0, y: 0, w: 10, h: 10 }, 1, 0).scale, 1);
});

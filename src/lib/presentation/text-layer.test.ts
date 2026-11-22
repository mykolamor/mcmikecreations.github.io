import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitRun, groupLines, type Word } from './text-layer';

const word = (start: number, end: number, x: number, y: number, w: number, h = 40): Word => ({ start, end, x, y, w, h });

test('groupLines joins words on one line, keeping their text and spanning their boxes', () => {
	const text = 'Fused  kernels win';
	const runs = groupLines(text, [word(0, 5, 100, 200, 90), word(7, 14, 200, 202, 120), word(15, 18, 330, 200, 50)]);
	assert.deepEqual(runs, [{ text: 'Fused kernels win', x: 100, y: 200, w: 280, h: 42 }]);
});

test('groupLines starts a new line when the text wraps back left', () => {
	const runs = groupLines('one two three', [word(0, 3, 100, 100, 60), word(4, 7, 170, 100, 60), word(8, 13, 100, 150, 90)]);
	assert.deepEqual(runs.map((r) => [r.text, r.x, r.y]), [['one two', 100, 100], ['three', 100, 150]]);
});

test('groupLines starts a new line when a word sits lower without overlapping', () => {
	const runs = groupLines('a b', [word(0, 1, 100, 100, 20), word(2, 3, 300, 160, 20)]);
	assert.equal(runs.length, 2);
});

test('groupLines skips words without a box', () => {
	assert.deepEqual(groupLines('a b', [word(0, 1, 0, 0, 0), word(2, 3, 10, 10, 20)]).map((r) => r.text), ['b']);
});

test('fitRun sizes the font to the box height and stretches the width onto the box', () => {
	// A 1600×900 slide on a 1200×675 pt page: 0.75 pt per pixel.
	const fit = fitRun({ text: 'x', x: 100, y: 200, w: 300, h: 48 }, 0.75, 0.5);
	assert.ok(Math.abs(fit.size - (48 * 0.75 * 2048) / 2400) < 1e-9);
	assert.equal(fit.x, 75);
	assert.ok(Math.abs(fit.y - (200 + 48 * (1900 / 2400)) * 0.75) < 1e-9);
	assert.ok(Math.abs(fit.scale * 0.5 * fit.size - 300 * 0.75) < 1e-9);
});

test('fitRun keeps scale 1 for text it cannot measure', () => {
	assert.equal(fitRun({ text: '', x: 0, y: 0, w: 10, h: 10 }, 1, 0).scale, 1);
});

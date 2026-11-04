import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectRadiusM, metresPerPixel } from './inspect-radius';

test('radius is ~12 px in metres and clamped 5-200', () => {
	const at13 = inspectRadiusM(13, 47.7);
	assert.ok(Math.abs(at13 - metresPerPixel(13, 47.7) * 12) < 1e-9);
	assert.ok(at13 > 150 && at13 < 160, String(at13));
	assert.equal(inspectRadiusM(18, 47.7), 5);
	assert.equal(inspectRadiusM(5, 47.7), 200);
});

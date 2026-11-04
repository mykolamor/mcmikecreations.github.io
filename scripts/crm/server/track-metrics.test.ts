import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackMetrics } from './track-metrics';
import { repoPaths } from './paths';

const REAL_ROOT = join(__dirname, '../../..');
const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures/track-metrics-golden.json'), 'utf8')) as Record<string, { distance: number; ascent: number; descent: number; duration: number }>;

test('trackMetrics matches the Python values on every recorded track', () => {
	const files = Object.keys(golden);
	assert.ok(files.length > 30);
	for (const f of files) {
		const m = trackMetrics(readFileSync(join(repoPaths(REAL_ROOT).gpx, f), 'utf8'));
		assert.ok(m, f);
		assert.equal(m.ascent, golden[f].ascent, `${f} ascent`);
		assert.equal(m.descent, golden[f].descent, `${f} descent`);
		assert.equal(m.duration, golden[f].duration, `${f} duration`);
		assert.ok(Math.abs(m.distance - golden[f].distance) <= 1, `${f} distance ${m.distance} vs ${golden[f].distance}`);
	}
});

test('planned track (no <time>) returns null', () => {
	const gpx = '<gpx><trk><trkseg><trkpt lat="47" lon="11"><ele>1</ele></trkpt><trkpt lat="47.001" lon="11"><ele>3</ele></trkpt></trkseg></trk></gpx>';
	assert.equal(trackMetrics(gpx), null);
});

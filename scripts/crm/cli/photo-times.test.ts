import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPaths } from '../server/paths';
import type { Terrain } from '../server/terrain';
import { backfillPhotoTimes } from './photo-times';
import { parseArgs } from './index';
import { recorder } from './test-output';

/** As the Python tests' FakeTerrain: 1000 + lat, to one decimal. */
const fake: Terrain = { height: (lat) => Math.round((1000 + lat) * 10) / 10 };

type Pt = [lat: number, lon: number, utc: string];

/** The Python tests' TRACK: straight north along lon 11.0, 10:00-11:00 UTC, 0.01° (~1.1 km) per 10 min. */
const TRACK: Pt[] = Array.from({ length: 7 }, (_, i) => [47 + i * 0.01, 11, new Date(Date.UTC(2026, 5, 1, 10, i * 10)).toISOString()]);

const gpx = (pts: Pt[]) =>
	`<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.map(([lat, lon, t]) => `<trkpt lat="${lat}" lon="${lon}"><time>${t}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;

const POST = '2026-06-01-demo.md';

/** A post with these `images` lines; `track` null: no GPX (a planned hike). */
function setup(images: string[], track: Pt[] | null = TRACK) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-photo-times-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.gpx]) mkdirSync(d, { recursive: true });
	writeFileSync(join(p.markdown, 'demo.hike.json'), '{\n  "name": "Demo"\n}\n');
	const gpxLine = track ? 'gpx: /_projects/data-viz/hikes/gpx/demo.gpx\n' : '';
	if (track) writeFileSync(join(p.gpx, 'demo.gpx'), gpx(track));
	const post = join(p.markdown, POST);
	writeFileSync(post, `---\ntitle: Demo # kept\n${gpxLine}images:\n${images.map((l) => '  ' + l).join('\n')}\n---\nbody\n`);
	return { root, post, rel: `static/_projects/data-viz/hikes/markdown/${POST}` };
}

const go = (root: string, argv: string[] = []) => {
	const out = recorder();
	return backfillPhotoTimes(root, parseArgs(['photo-times', ...argv]), out, fake).then((code) => ({ code, out }));
};

const imageLines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('  '));

test('offset mismatch is not believable', async () => {
	const lines = [
		"a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:00:00+02:00'}",
		"b.jpg: {w: 4, h: 3, taken: '2026-06-01T13:00:00+02:00'}",
		"c.jpg: {w: 4, h: 3, taken: '2026-06-01T12:00:00+00:00'}"
	];
	const { root, post, rel } = setup(lines, null);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: c\\.jpg: taken 2026-06-01T12:00:00\\+00:00 .*offset \\+00:00.*\\+02:00`));
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('date outside the track span is not believable', async () => {
	const { root, post, rel } = setup([
		"a.jpg: {w: 4, h: 3, lat: 47.0, lon: 11.0, taken: '2026-06-02T15:00:00+02:00'}",
		"b.jpg: {w: 4, h: 3, taken: '2026-06-02T12:30:00+02:00'}",
		"c.jpg: {w: 4, h: 3, lat: 47.02, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}"
	]);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.warnings.length, 2);
	out.warnings.forEach((w, i) => assert.match(w, new RegExp(`^${rel}: ${'ab'[i]}\\.jpg: taken 2026-06-02T.*2026-06-02 is not a day of the recording`)));
	// b.jpg has no GPS but an unbelievable time: not placed
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('a recorded hike uses the track span, not the post date', async () => {
	// Overnight: the track runs past local midnight.
	const night: Pt[] = [
		[47.0, 11.0, '2026-06-01T21:00:00Z'],
		[47.01, 11.0, '2026-06-01T22:30:00Z']
	];
	const { root } = setup(["a.jpg: {w: 4, h: 3, lat: 47.01, lon: 11.0, taken: '2026-06-02T00:30:00+02:00'}"], night);
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.warnings, []);
});

test('GPS 251 m off the track is not believable', async () => {
	// At 10:20 UTC the track is at 47.02; 0.002257° of latitude is 251 m, 0.002239° is 249 m.
	const { root, post, rel } = setup([
		"a.jpg: {w: 4, h: 3, lat: 47.022257, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}",
		"b.jpg: {w: 4, h: 3, lat: 47.022239, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}"
	]);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: a\\.jpg: taken 2026-06-01T12:20:00\\+02:00 .*251 m from the photo`));
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('track placement within 15 min sets located: track and demEle', async () => {
	const { root, post, rel } = setup([
		"a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', blur: 'data:a'}",
		"b.jpg: {w: 4, h: 3, taken: '2026-06-01T13:14:00+02:00', blur: 'data:b'}",
		"c.jpg: {w: 4, h: 3, taken: '2026-06-01T13:16:00+02:00', blur: 'data:c'}",
		"d.jpg: {w: 4, h: 3, taken: '2026-06-01T11:46:00+02:00', blur: 'data:d'}"
	]);
	const before = readFileSync(post, 'utf8');
	const dry = await go(root, ['--dry-run']);
	assert.equal(dry.code, 0);
	assert.deepEqual(dry.out.changes, [`${rel}: placed 3 photo(s) on the track`]);
	assert.equal(readFileSync(post, 'utf8'), before, 'dry run writes nothing');

	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, dry.out.changes);
	assert.deepEqual(out.warnings, []);
	assert.deepEqual(imageLines(post), [
		"  a.jpg: {w: 4, h: 3, lat: 47.03, lon: 11, demEle: 1047.0, taken: '2026-06-01T12:30:00+02:00', located: track, blur: 'data:a'}",
		// 14 min after the recording ended: at its last point
		"  b.jpg: {w: 4, h: 3, lat: 47.06, lon: 11, demEle: 1047.1, taken: '2026-06-01T13:14:00+02:00', located: track, blur: 'data:b'}",
		// 16 min after: the time stands, the place is unknown
		"  c.jpg: {w: 4, h: 3, taken: '2026-06-01T13:16:00+02:00', blur: 'data:c'}",
		// 14 min before it started: at its first point
		"  d.jpg: {w: 4, h: 3, lat: 47, lon: 11, demEle: 1047.0, taken: '2026-06-01T11:46:00+02:00', located: track, blur: 'data:d'}"
	]);
	assert.match(readFileSync(post, 'utf8'), /^---\ntitle: Demo # kept\n/);
	assert.match(readFileSync(post, 'utf8'), /\n---\nbody\n$/);
});

test('a gap where the track moved is not placed', async () => {
	const gap: Pt[] = [
		[47.0, 11.0, '2026-06-01T10:00:00Z'],
		[47.1, 11.0, '2026-06-01T11:00:00Z']
	];
	const { root, post, rel } = setup(
		[
			"a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00'}",
			// with GPS, inside the gap: checked against the line between its ends
			"b.jpg: {w: 4, h: 3, lat: 47.07, lon: 11.0, taken: '2026-06-01T12:30:00+02:00'}",
			"c.jpg: {w: 4, h: 3, lat: 47.05, lon: 11.01, taken: '2026-06-01T12:30:00+02:00'}"
		],
		gap
	);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, []);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: c\\.jpg: `));
	assert.equal(readFileSync(post, 'utf8'), before);

	// a gap where the track stayed (a break at a hut) is placed
	const hut: Pt[] = [
		[47.0, 11.0, '2026-06-01T10:00:00Z'],
		[47.0001, 11.0, '2026-06-01T20:00:00Z']
	];
	const h = setup(["a.jpg: {w: 4, h: 3, taken: '2026-06-01T17:00:00+02:00'}"], hut);
	await go(h.root);
	assert.deepEqual(imageLines(h.post), ["  a.jpg: {w: 4, h: 3, lat: 47.00005, lon: 11, demEle: 1047.0, taken: '2026-06-01T17:00:00+02:00', located: track}"]);
});

test('a track-located photo that can no longer be placed loses its position', async () => {
	const { root, post, rel } = setup([
		// two hours after the recording ended
		"a.jpg: {w: 4, h: 3, taken: '2026-06-01T15:00:00+02:00', lat: 47.06, lon: 11.0, demEle: 1047.1, located: track, blur: 'data:a'}",
		// a time that can't be read
		"b.jpg: {w: 4, h: 3, taken: 'x', lat: 47.03, lon: 11.0, demEle: 1047.0, located: track}",
		// still placeable: kept as it is (taken before lat, as the Python wrote it)
		"c.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, demEle: 1047.0, located: track}"
	]);
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, [`${rel}: dropped 2 track position(s)`]);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: b\\.jpg: taken x `));
	assert.deepEqual(imageLines(post), [
		"  a.jpg: {w: 4, h: 3, taken: '2026-06-01T15:00:00+02:00', blur: 'data:a'}",
		"  b.jpg: {w: 4, h: 3, taken: 'x'}",
		"  c.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, demEle: 1047.0, located: track}"
	]);
});

test('an unbelievable taken is reported, not deleted', async () => {
	// Taken at 10:20 UTC (track at 47.02) but pinned at 47.05, ~3.3 km away. The Python dropped this taken.
	const { root, post, rel } = setup(["a.jpg: {w: 4, h: 3, lat: 47.05, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}"]);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, []);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: a\\.jpg: taken 2026-06-01T12:20:00\\+02:00 `));
	assert.match(out.warnings[0], /3336 m from the photo/);
	assert.match(out.summaries.at(-1)!, /1 unbelievable taken reported/);
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('photo GPS is never touched', async () => {
	const own = [
		// agrees with the track
		"a.jpg: {w: 4, h: 3, lat: 47.02, lon: 11.0, demEle: 1047.0, taken: '2026-06-01T12:20:00+02:00'}",
		// disagrees with it
		"b.jpg: {w: 4, h: 3, lat: 47.05, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}",
		// no time at all
		'c.jpg: {w: 4, h: 3, lat: 46.0, lon: 10.0}',
		// outside the recording
		"d.jpg: {w: 4, h: 3, lat: 47.5, lon: 11.0, taken: '2026-06-01T18:00:00+02:00'}"
	];
	const { root, post } = setup([...own, "e.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00'}"]);
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.changes.length, 1, 'e.jpg is placed, so the file is written');
	assert.deepEqual(imageLines(post).slice(0, 4), own.map((l) => '  ' + l));
});

test('a track position from within the second of taken is kept', async () => {
	// The Python placed photos at Immich's millisecond time; `taken` keeps whole seconds. At 10:30:00.600 the track
	// was at 47.03001 (1.85 m/s north), which a re-placement at 10:30:00 would move by 1.1 m.
	const { root, post, rel } = setup([
		"a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03001, lon: 11.0, demEle: 1047.0, located: track}",
		"b.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03003, lon: 11.0, demEle: 1047.0, located: track}"
	]);
	const { code, out } = await go(root);
	assert.equal(code, 0);
	// b.jpg is 3.3 m on, 1.5 m past where the track was at the end of that second: moved
	assert.deepEqual(out.changes, [`${rel}: moved 1 track position(s)`]);
	assert.deepEqual(imageLines(post), [
		"  a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03001, lon: 11.0, demEle: 1047.0, located: track}",
		"  b.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, demEle: 1047.0, located: track}"
	]);
});

test('a second run changes nothing', async () => {
	const { root, post } = setup([
		"a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', blur: 'data:a'}",
		"b.jpg: {w: 4, h: 3, taken: '2026-06-01T15:00:00+02:00', lat: 47.06, lon: 11.0, demEle: 1047.1, located: track}",
		"c.jpg: {w: 4, h: 3, lat: 47.05, lon: 11.0, taken: '2026-06-01T12:20:00+02:00'}"
	]);
	const first = await go(root);
	assert.equal(first.out.changes.length, 1);
	const after = readFileSync(post, 'utf8');
	const second = await go(root);
	assert.equal(second.code, 0);
	assert.deepEqual(second.out.changes, []);
	assert.equal(readFileSync(post, 'utf8'), after);
});

test('photo-times exits 1 naming an unreadable post', async () => {
	const { root, rel } = setup([]);
	writeFileSync(join(root, rel), '---\ntitle: [unclosed\n---\nbody\n');
	const { code, out } = await go(root);
	assert.equal(code, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: `));
});

test('a track-located entry in the Python order gains demEle after lon', async () => {
	// taken before lat, as the Python wrote it; no demEle yet (the DEM tiles didn't cover it then)
	const { root, post } = setup(["a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, located: track, blur: 'data:a'}"]);
	const { code } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(imageLines(post), ["  a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, demEle: 1047.0, located: track, blur: 'data:a'}"]);
});

test("a planned hike's taken on another date gets one warning", async () => {
	const { root, post, rel } = setup(
		["a.jpg: {w: 4, h: 3, lat: 47.0, lon: 11.0, taken: '2026-06-01T12:00:00+02:00'}", "b.jpg: {w: 4, h: 3, taken: '2000-01-01T00:00:00+02:00'}"],
		null
	);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: b\\.jpg: taken 2000-01-01T00:00:00\\+02:00 not believable \\(not the post date 2026-06-01\\)`));
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('a photo with GPS taken after the recording ended passes at the end point', async () => {
	// 13:00 UTC, two hours after the recording ended at 47.06: a.jpg is there, b.jpg 3.3 km back along the track
	const { root, post, rel } = setup([
		"a.jpg: {w: 4, h: 3, lat: 47.06, lon: 11.0, taken: '2026-06-01T15:00:00+02:00'}",
		"b.jpg: {w: 4, h: 3, lat: 47.03, lon: 11.0, taken: '2026-06-01T15:00:00+02:00'}"
	]);
	const before = readFileSync(post, 'utf8');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.equal(out.warnings.length, 1);
	assert.match(out.warnings[0], new RegExp(`^${rel}: b\\.jpg: taken .*3336 m from the photo`));
	assert.equal(readFileSync(post, 'utf8'), before);
});

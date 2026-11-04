import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDoc } from '../server/doc';
import { repoPaths } from '../server/paths';
import { trackMetrics } from '../server/track-metrics';
import { metrics } from './metrics';
import { parseArgs } from './index';
import { recorder } from './test-output';

function gpx(timed: boolean): string {
	const pts = Array.from({ length: 30 }, (_, i) => {
		const t = timed ? `<time>${new Date(Date.UTC(2024, 0, 1, 8, 0, i * 30)).toISOString()}</time>` : '';
		return `<trkpt lat="${47 + i * 0.0005}" lon="11"><ele>${1000 + i * 5}</ele>${t}</trkpt>`;
	}).join('');
	return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

const POST = '2024-01-01-foo.md';
const FRONT = '---\ntitle: T\ndistance: 5 # by hand\ngpx: /_projects/data-viz/hikes/gpx/foo.gpx\nimages:\n  a.jpg: {w: 1}\n---\nBody\n';

function setup(front = FRONT, timed = true) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-metrics-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.gpx]) mkdirSync(d, { recursive: true });
	writeFileSync(join(p.markdown, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(p.markdown, POST), front);
	writeFileSync(join(p.gpx, 'foo.gpx'), gpx(timed));
	return { root, post: join(p.markdown, POST) };
}

const go = (root: string, argv: string[]) => {
	const out = recorder();
	return metrics.run(root, parseArgs(['metrics', ...argv]), out).then((code) => ({ code, out }));
};

test('metrics --missing-only fills only absent fields', async () => {
	const { root, post } = setup();
	const m = trackMetrics(gpx(true))!;
	const { code, out } = await go(root, ['--missing-only']);
	assert.equal(code, 0);
	const text = readFileSync(post, 'utf8');
	assert.equal(
		text,
		`---\ntitle: T\ndistance: 5 # by hand\ngpx: /_projects/data-viz/hikes/gpx/foo.gpx\nascent: ${m.ascent}\ndescent: ${m.descent}\nduration: ${m.duration}\nimages:\n  a.jpg: {w: 1}\n---\nBody\n`
	);
	assert.equal(out.changes.length, 1);
	assert.match(out.changes[0], /^static\/_projects\/data-viz\/hikes\/markdown\/2024-01-01-foo\.md: ascent -->\d+, descent -->\d+, duration -->\d+$/);
	assert.doesNotMatch(out.changes[0], /distance/);
	assert.match(out.summaries.join('\n'), /1 post/);
});

test('metrics without --missing-only overwrites changed values only', async () => {
	const { root, post } = setup();
	const m = trackMetrics(gpx(true))!;
	assert.equal((await go(root, [])).code, 0);
	assert.match(readFileSync(post, 'utf8'), new RegExp(`^distance: ${m.distance} # by hand$`, 'm'));
});

test('metrics --dry-run prints and writes nothing', async () => {
	const { root, post } = setup();
	const { code, out } = await go(root, ['--missing-only', '--dry-run']);
	assert.equal(code, 0);
	assert.equal(out.changes.length, 1);
	assert.equal(readFileSync(post, 'utf8'), FRONT);
	assert.match(out.summaries.join('\n'), /dry run/);
});

test('metrics skips a planned track', async () => {
	const { root, post } = setup(FRONT, false);
	const { code, out } = await go(root, []);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, []);
	assert.deepEqual(out.warnings, []);
	assert.match(out.summaries.join('\n'), /1 planned track skipped/);
	assert.equal(readFileSync(post, 'utf8'), FRONT);
});

test('a second run changes nothing', async () => {
	const { root, post } = setup();
	for (const argv of [['--missing-only'], []]) {
		const once = await go(root, argv);
		assert.equal(once.code, 0);
		assert.equal(once.out.changes.length, 1);
		const first = readFileSync(post, 'utf8');
		const again = await go(root, argv);
		assert.equal(again.code, 0);
		assert.deepEqual(again.out.changes, []);
		assert.equal(readFileSync(post, 'utf8'), first);
	}
});

test('metrics exits 1 naming an unreadable post', async () => {
	const { root } = setup();
	const p = repoPaths(root);
	writeFileSync(join(p.markdown, '2024-02-02-foo.md'), '---\ntitle: [unclosed\n---\nBody\n');
	const { code, out } = await go(root, ['--missing-only']);
	assert.equal(code, 1);
	assert.match(out.warnings.join('\n'), /2024-02-02-foo\.md/);
	// the readable post is still handled
	assert.equal(out.changes.length, 1);
});

test('metrics exits 1 naming a GPX that is not one', async () => {
	const { root } = setup();
	writeFileSync(join(repoPaths(root).gpx, 'foo.gpx'), 'garbage');
	const { code, out } = await go(root, ['--missing-only']);
	assert.equal(code, 1);
	assert.match(out.warnings.join('\n'), /foo\.gpx/);
});

test('metrics takes posts by name or path', async () => {
	const { root } = setup();
	writeFileSync(join(repoPaths(root).markdown, '2024-03-03-foo.md'), FRONT);
	const byName = await go(root, ['--dry-run', '2024-03-03-foo']);
	assert.equal(byName.out.changes.length, 1);
	assert.match(byName.out.changes[0], /2024-03-03-foo\.md/);
	const byPath = await go(root, ['--dry-run', 'static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md']);
	assert.equal(byPath.out.changes.length, 1);
	assert.match(byPath.out.changes[0], /2024-01-01-foo\.md/);
	const missing = await go(root, ['--dry-run', '2024-09-09-nope']);
	assert.equal(missing.code, 1);
	assert.match(missing.out.warnings.join('\n'), /2024-09-09-nope/);
});

test('a command write bumps the doc version the UI holds', async () => {
	const { root } = setup();
	const before = loadDoc(root, 'foo', '2024-01-01').version;
	await go(root, ['--missing-only']);
	assert.notEqual(loadDoc(root, 'foo', '2024-01-01').version, before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { repoPaths } from '../server/paths';
import { prebuild, removeStaleTemps, runSteps, type Step } from './prebuild';
import { parseArgs, type Command } from './index';
import { recorder } from './test-output';

test('prebuild runs the steps in order and stops at the first failure', async () => {
	const calls: string[] = [];
	const cmd = (name: string, code: number, flags: string[] = ['dry-run']): Command => ({
		name,
		summary: name,
		flags,
		run: async (_root, args) => {
			calls.push(`${name}${[...args.flags].map((f) => ' --' + f).join('')}`);
			return code;
		}
	});
	const steps: Step[] = [
		[cmd('one', 0), ['missing-only']],
		[cmd('two', 0, []), []],
		[cmd('three', 3), []],
		[cmd('four', 0), []]
	];
	const out = recorder();
	assert.equal(await runSteps('/nowhere', parseArgs(['prebuild', '--dry-run']), out, steps), 3);
	// --dry-run reaches every step that takes it; nothing runs after the failure
	assert.deepEqual(calls, ['one --missing-only --dry-run', 'two', 'three --dry-run']);
	assert.match(out.summaries.at(-1)!, /^prebuild: three failed \(exit 3\)/);

	calls.length = 0;
	assert.equal(await runSteps('/nowhere', parseArgs(['prebuild']), recorder(), steps.filter((s) => s[0].name !== 'three')), 0);
	assert.deepEqual(calls, ['one --missing-only', 'two', 'four']);

	assert.deepEqual(
		prebuild.steps.map(([c, f]) => [c.name, ...f].join(' ')),
		['metrics missing-only', 'photo-times', 'terrain', 'video-meta', 'images', 'check']
	);
});

/** Every file under `dir` with its bytes. */
function snapshot(dir: string, out = new Map<string, string>()): Map<string, string> {
	for (const f of readdirSync(dir)) {
		const p = path.join(dir, f);
		if (statSync(p).isDirectory()) snapshot(p, out);
		else out.set(p, readFileSync(p, 'latin1'));
	}
	return out;
}

test('a second prebuild changes nothing', async () => {
	process.env.CRM_YOUTUBE_STUB = '1';
	const root = mkdtempSync(path.join(tmpdir(), 'crm-cli-prebuild-'));
	const p = repoPaths(root);
	const stories = path.join(p.images, 'stories/foo');
	for (const d of [p.markdown, p.places, p.gpx, p.geojson, stories, path.dirname(p.hikesJson)]) mkdirSync(d, { recursive: true });
	writeFileSync(p.hikesJson, '[]\n');
	writeFileSync(p.osmStore, '{\n  "node/1": {\n    "lat": 47.5,\n    "lon": 11.0,\n    "tags": {\n      "name": "Hut"\n    }\n  }\n}\n');
	writeFileSync(path.join(p.markdown, 'foo.hike.json'), '{\n  "name": "Foo",\n  "nodes": ["node/1"]\n}\n');
	writeFileSync(path.join(p.geojson, 'foo.json'), '{}');
	const pts = Array.from({ length: 30 }, (_, i) => `<trkpt lat="${47 + i * 0.0005}" lon="11"><ele>${1000 + i * 5}</ele><time>${new Date(Date.UTC(2024, 0, 1, 8, 0, i * 30)).toISOString()}</time></trkpt>`).join('');
	writeFileSync(path.join(p.gpx, 'foo.gpx'), `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts}</trkseg></trk></gpx>`);
	writeFileSync(path.join(stories, '2024-01-01-00.jpg'), await sharp({ create: { width: 800, height: 600, channels: 3, background: '#468' } }).jpeg().toBuffer());
	writeFileSync(path.join(p.markdown, '2024-01-01-foo.md'), '---\ntitle: T\n---\n![a](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)\n');

	const first = recorder();
	assert.equal(await prebuild.run(root, parseArgs(['prebuild']), first), 0, first.warnings.join('\n'));
	assert.ok(first.changes.length >= 2, first.changes.join('\n')); // metrics and images wrote the post
	const before = snapshot(root);

	const second = recorder();
	assert.equal(await prebuild.run(root, parseArgs(['prebuild']), second), 0, second.warnings.join('\n'));
	assert.deepEqual(second.changes, []);
	assert.deepEqual(snapshot(root), before);
});

test('prebuild removes stale temp files under static/ first', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-cli-prebuild-tmp-'));
	const dir = path.join(root, 'static/_projects/data-viz/hikes/markdown');
	const stories = path.join(root, 'static/images/projects/data-viz/hikes/stories/foo');
	for (const d of [dir, stories]) mkdirSync(d, { recursive: true });
	const old = new Date(Date.now() - 2 * 3600 * 1000);
	const file = (p: string, at = old) => (writeFileSync(p, 'x'), utimesSync(p, at, at), p);
	// left by a writer that died (pids above Linux's pid_max) (writeAllAtomic, the AVIF encoder) and an upload that never finished
	const stale = [file(path.join(dir, '2024-01-01-foo.md.4999998.tmp')), file(path.join(stories, '2024-01-01-01-640.avif.4999999.tmp')), file(path.join(stories, '.upload-0123456789ab.part'))];
	const kept = [
		file(path.join(dir, `foo.hike.json.${process.pid}.tmp`)), // a live process's (a UI running beside)
		file(path.join(stories, '.upload-abcdef012345.part'), new Date()), // an upload still coming in
		file(path.join(dir, 'notes.tmp')),
		file(path.join(stories, 'upload-0123456789ab.part')),
		file(path.join(root, 'scripts.1234.tmp')) // not under static/
	];
	const rel = (p: string) => path.relative(root, p);

	const dry = recorder();
	assert.equal(removeStaleTemps(root, true, dry), 3);
	assert.deepEqual(dry.changes.sort(), stale.map((p) => `${rel(p)}: stale temp file, would remove`).sort());
	assert.ok([...stale, ...kept].every((p) => existsSync(p)));

	const out = recorder();
	await prebuild.run(root, parseArgs(['prebuild']), out);
	assert.deepEqual(out.changes.slice(0, 3).sort(), stale.map((p) => `${rel(p)}: stale temp file, removed`).sort());
	assert.equal(out.summaries[0], 'prebuild: 3 stale temp files removed');
	assert.ok(stale.every((p) => !existsSync(p)));
	assert.ok(kept.every((p) => existsSync(p)));
});

test("every prebuild step's flags are ones its command takes", () => {
	for (const [cmd, flags] of prebuild.steps) for (const f of flags) assert.ok((cmd.flags ?? []).includes(f), `${cmd.name} has no --${f}`);
});

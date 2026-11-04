import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApi, type ApiRequest } from './api';
import { filesState } from './files';
import { trackMetrics } from './track-metrics';
import { repoPaths } from './paths';

function timedGpx(): string {
	const pts = Array.from({ length: 30 }, (_, i) => {
		const t = new Date(Date.UTC(2024, 0, 1, 8, 0, i * 30)).toISOString();
		return `<trkpt lat="${47 + i * 0.0005}" lon="11"><ele>${1000 + i * 5}</ele><time>${t}</time></trkpt>`;
	}).join('');
	return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

function setup(gpx: string | null = timedGpx()) {
	const root = mkdtempSync(join(tmpdir(), 'crm-gen-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.gpx, p.images, p.thumbs]) mkdirSync(d, { recursive: true });
	writeFileSync(join(p.markdown, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	const front = `---\ntitle: T\ndistance: 5\n${gpx ? 'gpx: /_projects/data-viz/hikes/gpx/foo.gpx\n' : ''}---\nBody\n`;
	writeFileSync(join(p.markdown, '2024-01-01-foo.md'), front);
	if (gpx) writeFileSync(join(p.gpx, 'foo.gpx'), gpx);
	return { root, p };
}
const q = (o: Record<string, string>) => new URLSearchParams(o);
const call = (api: ReturnType<typeof createApi>, method: string, path: string, query: Record<string, string>) => api({ method, path, query: q(query), headers: {} } as ApiRequest);
const key = { slug: 'foo', date: '2024-01-01' };

test('recompute overwrites the four keys, needs base, 409 on a stale one', async () => {
	const { root, p } = setup();
	const api = createApi(root);
	const v0 = (((await call(api, 'GET', '/api/doc', key)).json as any).doc).version;
	assert.equal((await call(api, 'POST', '/api/metrics/recompute', key)).status, 400);
	const stale = await call(api, 'POST', '/api/metrics/recompute', { ...key, base: 'stale' });
	assert.equal(stale.status, 409);
	assert.doesNotMatch(readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8'), /duration/);
	const ok = await call(api, 'POST', '/api/metrics/recompute', { ...key, base: v0 });
	assert.equal(ok.status, 200);
	const j = ok.json as any;
	const want = trackMetrics(timedGpx())!;
	const md = readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8');
	assert.match(md, new RegExp(`distance: ${want.distance}\\n`));
	assert.doesNotMatch(md, /distance: 5\n/);
	assert.match(md, new RegExp(`ascent: ${want.ascent}\\n`));
	assert.match(md, new RegExp(`duration: ${want.duration}\\n`));
	assert.notEqual(j.version, v0);
	const g = await call(api, 'GET', '/api/metrics', key);
	assert.equal((g.json as any).current.distance, want.distance);
});

test('recompute on a planned track is a 400 and writes nothing', async () => {
	const { root, p } = setup(timedGpx().replace(/<time>[^<]*<\/time>/g, ''));
	const api = createApi(root);
	const v0 = (((await call(api, 'GET', '/api/doc', key)).json as any).doc).version;
	const before = readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8');
	const r = await call(api, 'POST', '/api/metrics/recompute', { ...key, base: v0 });
	assert.equal(r.status, 400);
	assert.equal(readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8'), before);
});

test('thumbnail ok means it exists and is not older than the cover; rebuild fixes a stale one', async () => {
	const { root, p } = setup();
	writeFileSync(join(p.markdown, 'foo.hike.json'), '{\n  "name": "Foo",\n  "image": "/images/projects/data-viz/hikes/foo.jpg"\n}\n');
	const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2a7' } }).jpeg().toBuffer();
	writeFileSync(join(p.images, 'foo.jpg'), jpg);
	const api = createApi(root);
	assert.equal((await filesState(root, 'foo', '2024-01-01')).cover!.thumbOk, false); // no thumb yet
	const rb = await call(api, 'POST', '/api/thumbnail/rebuild', key);
	assert.equal(rb.status, 200);
	assert.equal((rb.json as any).files.cover.thumbOk, true);
	const t = await sharp(join(p.thumbs, 'foo.jpg')).metadata();
	assert.ok(t.width! <= 400 && t.height! <= 300);
	// cover replaced after the thumb was made: stale until rebuilt
	const later = new Date(Date.now() + 60_000);
	utimesSync(join(p.images, 'foo.jpg'), later, later);
	assert.equal((await filesState(root, 'foo', '2024-01-01')).cover!.thumbOk, false);
	utimesSync(join(p.images, 'foo.jpg'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
	assert.equal((await filesState(root, 'foo', '2024-01-01')).cover!.thumbOk, true);
});

test('recompute inserts new metric keys before images:, like field edits do', async () => {
	const { root, p } = setup();
	const mdPath = join(p.markdown, '2024-01-01-foo.md');
	writeFileSync(mdPath, '---\ntitle: T\ngpx: /_projects/data-viz/hikes/gpx/foo.gpx\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nBody\n');
	const api = createApi(root);
	const v0 = (((await call(api, 'GET', '/api/doc', key)).json as any).doc).version;
	assert.equal((await call(api, 'POST', '/api/metrics/recompute', { ...key, base: v0 })).status, 200);
	const md = readFileSync(mdPath, 'utf8');
	const keys = [...md.matchAll(/^([a-z]+):/gm)].map((m) => m[1]);
	assert.deepEqual(keys, ['title', 'gpx', 'distance', 'ascent', 'descent', 'duration', 'images']);
	assert.match(md, /images:\n {2}x\.jpg: \{w: 1, h: 2\}\n---\nBody\n$/);
});

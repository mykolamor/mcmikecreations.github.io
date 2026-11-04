import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { depsVersion, filesState, pngToSrgbJpeg, tagPng, addBailout, replaceBailout, writeCover, writeGeojson, writeGpx } from './files';
import { repoPaths } from './paths';
import { createApi } from './api';
import { ApiError } from './errors';

const HEIC = join(__dirname, '../data/fixtures/sample.heic');

function gpxText(n = 5): string {
	const pts = Array.from({ length: n }, (_, i) => `<trkpt lat="${47 + i * 0.001}" lon="11"><ele>1</ele></trkpt>`).join('');
	return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

function tmpRoot(posts: string[] = ['2024-01-01-foo'], sidecar: object = { name: 'Foo', description: 'D' }) {
	const root = mkdtempSync(join(tmpdir(), 'crm-files-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.gpx, p.bailouts, p.geojson, p.images, p.thumbs]) mkdirSync(d, { recursive: true });
	writeFileSync(join(p.markdown, 'foo.hike.json'), JSON.stringify(sidecar, null, 2) + '\n');
	for (const d of posts) writeFileSync(join(p.markdown, `${d}.md`), '---\ntitle: T\n---\nBody\n');
	return { root, p };
}

async function jpeg(w: number, h: number): Promise<Buffer> {
	return sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 30 } } }).jpeg().toBuffer();
}

test('jpg cover is copied byte-for-byte and the thumb is <=400x300', async () => {
	const { root, p } = tmpRoot();
	const src = await jpeg(1200, 900);
	await writeCover(root, 'foo', src, 'IMG_1.jpg', 'hike', '2024-01-01');
	assert.deepEqual(readFileSync(join(p.images, 'foo.jpg')), src);
	const t = await sharp(join(p.thumbs, 'foo.jpg')).metadata();
	assert.ok(t.width! <= 400 && t.height! <= 300);
	assert.equal(t.width, 400);
	assert.match(readFileSync(join(p.markdown, 'foo.hike.json'), 'utf8'), /"image": "\/images\/projects\/data-viz\/hikes\/foo\.jpg"/);
	const st = await filesState(root, 'foo', '2024-01-01');
	assert.deepEqual(st.cover, { path: '/images/projects/data-viz/hikes/foo.jpg', w: 1200, h: 900, bytes: src.length, thumbOk: true });
});

test('a P3 image comes out sRGB', async () => {
	// pixel (200,100,50) in Display P3, tagged with the P3 profile
	const p3icc = (await sharp(await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).withIccProfile('p3').jpeg().toBuffer()).metadata()).icc!;
	const raw = Buffer.alloc(8 * 8 * 3);
	for (let i = 0; i < 64; i++) raw.set([200, 100, 50], i * 3);
	const p3 = tagPng(await sharp(raw, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer(), p3icc);
	const out = await pngToSrgbJpeg(p3);
	const meta = await sharp(out).metadata();
	if (meta.icc) assert.match(meta.icc.toString('latin1'), /sRGB/i);
	const px = await sharp(out).raw().toBuffer();
	// expected: P3 -> linear -> XYZ(D65) -> linear sRGB -> sRGB gamma
	const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const enc = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
	const [r, g, b] = [200, 100, 50].map(lin);
	const X = 0.4865709 * r + 0.2656677 * g + 0.1982173 * b;
	const Y = 0.2289746 * r + 0.6917385 * g + 0.0792869 * b;
	const Z = 0.0 * r + 0.0451134 * g + 1.0439444 * b;
	const want = [enc(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z), enc(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z), enc(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z)];
	for (let k = 0; k < 3; k++) assert.ok(Math.abs(px[k] - want[k]) <= 2, `channel ${k}: got ${px[k]}, want ${want[k]}`);
});

test('heic cover decodes to a JPEG of the same size', { skip: existsSync(HEIC) ? false : 'scripts/crm/data/fixtures/sample.heic is missing (run scripts/crm/fetch-fixtures.ts)' }, async () => {
	const { root, p } = tmpRoot();
	await writeCover(root, 'foo', readFileSync(HEIC), 'IMG.HEIC', 'hike', '2024-01-01');
	const m = await sharp(join(p.images, 'foo.jpg')).metadata();
	assert.equal(m.format, 'jpeg');
	assert.deepEqual([m.width, m.height], [4080, 3060]);
	if (m.icc) assert.match(m.icc.toString('latin1'), /sRGB/i);
});

test('failed cover conversion leaves the old cover', async () => {
	const { root, p } = tmpRoot();
	const old = await jpeg(100, 80);
	await writeCover(root, 'foo', old, 'a.jpg', 'hike', '2024-01-01');
	await assert.rejects(writeCover(root, 'foo', Buffer.from('garbage bytes'), 'b.heic', 'hike', '2024-01-01'), (e) => e instanceof ApiError && e.status === 400);
	assert.deepEqual(readFileSync(join(p.images, 'foo.jpg')), old);
});

test("the first post's cover is <slug>.jpg and a later visit's defaults to <slug>_<YYYY>.jpg", async () => {
	const { root, p } = tmpRoot(['2024-01-01-foo', '2026-05-05-foo']);
	await writeCover(root, 'foo', await jpeg(50, 50), 'a.jpg', null, '2024-01-01');
	assert.ok(existsSync(join(p.images, 'foo.jpg')));
	await writeCover(root, 'foo', await jpeg(60, 60), 'a.jpg', null, '2026-05-05');
	assert.ok(existsSync(join(p.images, 'foo_2026.jpg')));
	assert.ok(existsSync(join(p.thumbs, 'foo_2026.jpg')));
	assert.match(readFileSync(join(p.markdown, '2026-05-05-foo.md'), 'utf8'), /image: \/images\/projects\/data-viz\/hikes\/foo_2026\.jpg/);
	// the UI can switch scope for a later visit
	await writeCover(root, 'foo', await jpeg(70, 70), 'a.jpg', 'hike', '2026-05-05');
	assert.equal((await sharp(join(p.images, 'foo.jpg')).metadata()).width, 70);
});

test('the first post gets <slug>.gpx and a later visit gets <slug>_<YYYY>.gpx', async () => {
	const { root, p } = tmpRoot(['2024-01-01-foo', '2026-05-05-foo']);
	await writeGpx(root, 'foo', '2024-01-01', Buffer.from(gpxText()));
	assert.ok(existsSync(join(p.gpx, 'foo.gpx')));
	await writeGpx(root, 'foo', '2026-05-05', Buffer.from(gpxText()));
	assert.ok(existsSync(join(p.gpx, 'foo_2026.gpx')));
	assert.match(readFileSync(join(p.markdown, '2026-05-05-foo.md'), 'utf8'), /gpx: \/_projects\/data-viz\/hikes\/gpx\/foo_2026\.gpx/);
	// replaced in place when the post already has one
	const bigger = gpxText(9);
	await writeGpx(root, 'foo', '2026-05-05', Buffer.from(bigger));
	assert.equal(readFileSync(join(p.gpx, 'foo_2026.gpx'), 'utf8'), bigger);
	const st = await filesState(root, 'foo', '2026-05-05');
	assert.equal(st.gpx!.path, '/_projects/data-viz/hikes/gpx/foo_2026.gpx');
	assert.ok(st.gpx!.km > 0.8 && st.gpx!.km < 1);
});

test('depsVersion follows the route files, the OSM store and the facts library, not the doc', async () => {
	const { root, p } = tmpRoot();
	const v0 = depsVersion(root, 'foo', '2024-01-01');
	writeFileSync(join(p.gpx, 'foo.gpx'), gpxText());
	const v1 = depsVersion(root, 'foo', '2024-01-01');
	assert.notEqual(v1, v0, 'the GPX appearing');
	writeFileSync(join(p.geojson, 'foo.json'), '{}');
	const v2 = depsVersion(root, 'foo', '2024-01-01');
	assert.notEqual(v2, v1, 'the GeoJSON appearing');
	writeFileSync(p.osmStore, '{"elements":[]}');
	const v3 = depsVersion(root, 'foo', '2024-01-01');
	assert.notEqual(v3, v2, 'the OSM store');
	writeFileSync(p.factsLibrary, '{}');
	const v4 = depsVersion(root, 'foo', '2024-01-01');
	assert.notEqual(v4, v3, 'the facts library');
	writeFileSync(join(p.markdown, '2024-01-01-foo.md'), '---\ntitle: U\n---\nBody\n');
	assert.equal(depsVersion(root, 'foo', '2024-01-01'), v4, 'a doc edit is the doc version only');
	assert.equal(depsVersion(root, 'foo', '2024-01-01'), v4, 'stable');
});

test('invalid gpx is rejected', async () => {
	const { root, p } = tmpRoot();
	for (const bad of ['not xml', gpxText(1), '<gpx></gpx>'])
		await assert.rejects(writeGpx(root, 'foo', '2024-01-01', Buffer.from(bad)), (e) => e instanceof ApiError && e.status === 400);
	assert.ok(!existsSync(join(p.gpx, 'foo.gpx')));
});

test('geojson needs a LineString feature', async () => {
	const { root, p } = tmpRoot();
	const good = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[11, 47], [11, 47.01]] } }] };
	await writeGeojson(root, 'foo', Buffer.from(JSON.stringify(good)));
	assert.ok(existsSync(join(p.geojson, 'foo.json')));
	await assert.rejects(writeGeojson(root, 'foo', Buffer.from('{"type":"FeatureCollection","features":[]}')), (e) => e instanceof ApiError);
	const st = await filesState(root, 'foo', null);
	assert.ok(st.geojson!.km > 1);
});

test('bailout replacement only accepts known routes', async () => {
	const route = '/_projects/data-viz/hikes/gpx/bailouts/foo-x.gpx';
	const { root, p } = tmpRoot(['2024-01-01-foo'], { name: 'Foo', facts: { bailouts: [{ at: 'Hut', route }] } });
	await replaceBailout(root, route, Buffer.from(gpxText()));
	assert.ok(existsSync(join(p.bailouts, 'foo-x.gpx')));
	await assert.rejects(replaceBailout(root, '/_projects/data-viz/hikes/gpx/bailouts/other.gpx', Buffer.from(gpxText())), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(replaceBailout(root, route, Buffer.from('nope')), (e) => e instanceof ApiError);
	const st = await filesState(root, 'foo', '2024-01-01');
	assert.equal(st.bailouts.length, 1);
	assert.equal(st.bailouts[0].at, 'Hut');
	assert.ok(st.bailouts[0].km! > 0);
});

const q = (o: Record<string, string>) => new URLSearchParams(o);

test('PUT routes take a raw body, check base and return files + version', async () => {
	const { root } = tmpRoot();
	const api = createApi(root);
	const doc = async () => ((await api({ method: 'GET', path: '/api/doc', query: q({ slug: 'foo', date: '2024-01-01' }), headers: {} })).json as any).doc;
	const v0 = (await doc()).version;
	const put = (base: string | null, body: Buffer = Buffer.from(gpxText())) =>
		api({ method: 'PUT', path: '/api/files/gpx', query: q({ slug: 'foo', date: '2024-01-01', ...(base ? { base } : {}) }), body, headers: { 'x-filename': 'a.gpx' } });
	const r = await put(v0);
	assert.equal(r.status, 200);
	const j = r.json as any;
	assert.equal(j.files.gpx.path, '/_projects/data-viz/hikes/gpx/foo.gpx');
	assert.equal(j.version, (await doc()).version);
	assert.notEqual(j.version, v0);
	assert.equal((await put(v0, Buffer.from('x'))).status, 409); // stale base wins over validation
	assert.equal((await put(null)).status, 400);
	assert.equal((await put(j.version, Buffer.from('x'))).status, 400);
	assert.equal((await doc()).files.gpx.km > 0, true);
});

test('PUT /api/files/geojson writes the post GeoJSON and returns 200', async () => {
	const { root, p } = tmpRoot();
	const api = createApi(root);
	const doc = async () => ((await api({ method: 'GET', path: '/api/doc', query: q({ slug: 'foo', date: '2024-01-01' }), headers: {} })).json as any).doc;
	const base = (await doc()).version;
	const good = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[11, 47], [11, 47.01]] } }] };
	const r = await api({ method: 'PUT', path: '/api/files/geojson', query: q({ slug: 'foo', date: '2024-01-01', base }), body: Buffer.from(JSON.stringify(good)), headers: { 'x-filename': 'a.json' } });
	assert.equal(r.status, 200, JSON.stringify(r.json));
	assert.ok(existsSync(join(p.geojson, 'foo.json')));
	assert.ok((r.json as any).files.geojson.km > 0);
});

test('upload with a stale base is a 409 and writes nothing', async () => {
	const { root, p } = tmpRoot();
	const api = createApi(root);
	const r = await api({ method: 'PUT', path: '/api/files/gpx', query: q({ slug: 'foo', date: '2024-01-01', base: 'stale' }), body: Buffer.from(gpxText()), headers: {} });
	assert.equal(r.status, 409);
	const j = r.json as any;
	assert.equal(j.error, 'changed on disk');
	assert.ok(j.version && j.fields && j.mirrors);
	assert.ok(!existsSync(join(p.gpx, 'foo.gpx')));
	assert.doesNotMatch(readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8'), /gpx:/);
});

test('a PATCH and an upload on the same post issued together both land', async () => {
	const { root, p } = tmpRoot();
	const api = createApi(root);
	const key = { slug: 'foo', date: '2024-01-01' };
	const v0 = (((await api({ method: 'GET', path: '/api/doc', query: q(key), headers: {} })).json as any).doc).version;
	const patch = (base: string) => api({ method: 'PATCH', path: '/api/doc', query: q(key), json: { base, ops: [{ field: 'post.title', value: 'New title' }] }, headers: {} });
	const put = (base: string) => api({ method: 'PUT', path: '/api/files/gpx', query: q({ ...key, base }), body: Buffer.from(gpxText()), headers: {} });
	const [a, b] = await Promise.all([patch(v0), put(v0)]);
	// the loser got a 409 carrying the new version; retrying on it succeeds
	assert.deepEqual([a.status, b.status].sort(), [200, 409]);
	if (a.status === 409) await patch((a.json as any).version);
	else await put((b.json as any).version);
	const md = readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8');
	assert.match(md, /title: New title/);
	assert.match(md, /gpx: \/_projects\/data-viz\/hikes\/gpx\/foo\.gpx/);
});

test('a post cover never reuses the shared hike cover name', async () => {
	const { root, p } = tmpRoot(['2024-01-01-foo', '2026-05-05-foo']);
	writeFileSync(join(p.markdown, '2026-05-05-foo.md'), '---\ntitle: T\nimage: /images/projects/data-viz/hikes/foo.jpg\n---\nB\n');
	const hike = await jpeg(40, 40);
	await writeCover(root, 'foo', hike, 'a.jpg', 'hike', '2024-01-01');
	await writeCover(root, 'foo', await jpeg(60, 60), 'a.jpg', 'post', '2026-05-05');
	assert.deepEqual(readFileSync(join(p.images, 'foo.jpg')), hike);
	assert.ok(existsSync(join(p.images, 'foo_2026.jpg')));
	assert.match(readFileSync(join(p.markdown, '2026-05-05-foo.md'), 'utf8'), /image: \/images\/projects\/data-viz\/hikes\/foo_2026\.jpg/);
});

test('a post without gpx: relies on the default gpx/<slug>.gpx and its metrics compute', async () => {
	const { root, p } = tmpRoot();
	writeFileSync(join(p.gpx, 'foo.gpx'), gpxText(6));
	const st = await filesState(root, 'foo', '2024-01-01');
	assert.equal(st.gpx!.path, '/_projects/data-viz/hikes/gpx/foo.gpx');
	assert.ok(st.gpx!.km > 0);
	const { computedMetrics } = await import('./metrics');
	await computedMetrics(root, 'foo', '2024-01-01');
	// uploading replaces that default file in place and sets no gpx: key
	await writeGpx(root, 'foo', '2024-01-01', Buffer.from(gpxText(9)));
	assert.equal(readFileSync(join(p.gpx, 'foo.gpx'), 'utf8'), gpxText(9));
	assert.doesNotMatch(readFileSync(join(p.markdown, '2024-01-01-foo.md'), 'utf8'), /gpx:/);
});

test('a default gpx shared by two posts is not overwritten by an upload to one of them', async () => {
	const { root, p } = tmpRoot(['2024-01-01-foo', '2026-05-05-foo']);
	writeFileSync(join(p.gpx, 'foo.gpx'), gpxText(6));
	await writeGpx(root, 'foo', '2026-05-05', Buffer.from(gpxText(9)));
	assert.equal(readFileSync(join(p.gpx, 'foo.gpx'), 'utf8'), gpxText(6));
	assert.equal(readFileSync(join(p.gpx, 'foo_2026.gpx'), 'utf8'), gpxText(9));
	assert.match(readFileSync(join(p.markdown, '2026-05-05-foo.md'), 'utf8'), /gpx: \/_projects\/data-viz\/hikes\/gpx\/foo_2026\.gpx/);
});

test('an older post created later never takes the file another post uses', async () => {
	const { root, p } = tmpRoot(['2026-05-05-foo', '2024-01-01-foo']);
	writeFileSync(join(p.gpx, 'foo.gpx'), gpxText(6));
	await writeGpx(root, 'foo', '2024-01-01', Buffer.from(gpxText(9)));
	assert.equal(readFileSync(join(p.gpx, 'foo.gpx'), 'utf8'), gpxText(6));
	assert.ok(existsSync(join(p.gpx, 'foo_2024.gpx')));
});

test('a post filePath drives the GeoJSON card and its writer', async () => {
	const { root, p } = tmpRoot();
	const md = join(p.markdown, '2024-01-01-foo.md');
	writeFileSync(md, '---\ntitle: T\nfilePath: /_projects/data-viz/hikes/geojson/other.json\n---\nBody\n');
	const good = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[11, 47], [11, 47.01]] } }] };
	await writeGeojson(root, 'foo', Buffer.from(JSON.stringify(good)), '2024-01-01');
	assert.ok(existsSync(join(p.geojson, 'other.json')));
	assert.ok(!existsSync(join(p.geojson, 'foo.json')));
	const st = await filesState(root, 'foo', '2024-01-01');
	assert.equal(st.geojson!.path, '/_projects/data-viz/hikes/geojson/other.json');
});

test('a new bailout GPX gets a free name from the upload and never overwrites', async () => {
	const { root, p } = tmpRoot();
	const route = await addBailout(root, 'foo', Buffer.from(gpxText()), 'Kreuzbergköpfel Schliersee.GPX');
	assert.equal(route, '/_projects/data-viz/hikes/gpx/bailouts/kreuzbergkoepfel_schliersee.gpx');
	assert.ok(existsSync(join(p.bailouts, 'kreuzbergkoepfel_schliersee.gpx')));
	assert.equal(await addBailout(root, 'foo', Buffer.from(gpxText()), 'kreuzbergkoepfel_schliersee.gpx'), '/_projects/data-viz/hikes/gpx/bailouts/kreuzbergkoepfel_schliersee-2.gpx');
	assert.equal(await addBailout(root, 'foo', Buffer.from(gpxText()), ''), '/_projects/data-viz/hikes/gpx/bailouts/foo.gpx');
	await assert.rejects(addBailout(root, 'foo', Buffer.from('nope'), 'x.gpx'), (e) => e instanceof ApiError);
	await assert.rejects(addBailout(root, '../foo', Buffer.from(gpxText()), 'x.gpx'));
});

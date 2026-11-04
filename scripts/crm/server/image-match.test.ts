import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { blockMean, blockMeanDistance, findInImmich, hamming, phash } from './image-match';
import { createApi, defaultRoutes, type ApiRequest } from './api';
import { readLinks } from './immich-links';
import type { Asset, Immich } from './immich-client';
import type { DocRef } from './doc-ref';

const FIX = path.join(__dirname, 'fixtures/image-match');
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8')) as Record<string, { phash: string; blockMean: number[] }>;
const load = (n: string) => fs.readFileSync(path.join(FIX, n));
const bitsOf = (h: bigint) => Array.from({ length: 63 }, (_, i) => ((h >> BigInt(i)) & 1n ? '1' : '0')).join('');

// Python (PIL LANCZOS) and sharp (libvips lanczos3) resample slightly differently; tolerance: <= 2 differing hash bits, block-mean abs diff <= 0.003.
test('hash matches the Python implementation on 3 fixture images', async () => {
	for (const [name, want] of Object.entries(expected)) {
		const buf = load(name);
		const got = bitsOf(await phash(buf));
		const diff = [...got].filter((c, i) => c !== want.phash[i]).length;
		assert.ok(diff <= 2, `${name}: ${diff} phash bits differ`);
		const bm = await blockMean(buf);
		assert.equal(bm.length, 192);
		const mad = bm.reduce((s, v, i) => s + Math.abs(v - want.blockMean[i]), 0) / bm.length;
		assert.ok(mad <= 0.003, `${name}: block mean differs by ${mad}`);
	}
});

test('same image re-encoded matches with distance <= 0.004', async () => {
	const re = await sharp(load('sky-ridge.jpg')).resize(480).jpeg({ quality: 55 }).toBuffer();
	assert.ok(hamming(await phash(load('sky-ridge.jpg')), await phash(re)) <= 4);
	assert.ok(blockMeanDistance(await blockMean(load('sky-ridge.jpg')), await blockMean(re)) <= 0.004);
});

test('a different image does not', async () => {
	const d = blockMeanDistance(await blockMean(load('sky-ridge.jpg')), await blockMean(load('meadow-hut.jpg')));
	assert.ok(d > 0.004, `distance ${d}`);
	assert.ok(hamming(await phash(load('sky-ridge.jpg')), await phash(load('dusk-lake.jpg'))) > 4);
});

const DATE = '2026-01-11';
const REF: DocRef = { kind: 'post', slug: 'setzberg', date: DATE };
const UUID = '123e4567-e89b-12d3-a456-426614174000';
async function setup() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-match-'));
	const md = path.join(root, 'static/_projects/data-viz/hikes/markdown');
	fs.mkdirSync(md, { recursive: true });
	fs.writeFileSync(path.join(md, `${DATE}-setzberg.md`), `---\ntitle: T\nimages:\n  ${DATE}-00.jpg: { w: 240, h: 160 }\n---\nbody\n`);
	const dir = path.join(root, 'static/images/projects/data-viz/hikes/stories/setzberg');
	fs.mkdirSync(dir, { recursive: true });
	// only the AVIF tiers exist (the 2560 tier is absent for a 240 px photo; the larger of the present ones is read)
	await sharp(load('sky-ridge.jpg')).resize(200).avif({ quality: 50 }).toFile(path.join(dir, `${DATE}-00-640.avif`));
	await sharp(load('sky-ridge.jpg')).avif({ quality: 50 }).toFile(path.join(dir, `${DATE}-00-1280.avif`));
	return root;
}
const asset = (id: string): Asset => ({ id, fileName: `${id}.jpg`, takenLocal: `${DATE}T10:00:00+01:00`, width: 240, height: 160 });
const stub = (thumbs: Record<string, Buffer>): Immich =>
	({
		albums: async () => [],
		search: async () => Object.keys(thumbs).map(asset),
		thumb: async (id: string) => thumbs[id]
	}) as unknown as Immich;

test('findInImmich picks the re-encoded copy among other candidates', async () => {
	const root = await setup();
	const copy = await sharp(load('sky-ridge.jpg')).resize(360).jpeg({ quality: 85 }).toBuffer();
	const r = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich: stub({ a: load('meadow-hut.jpg'), b: copy, c: load('dusk-lake.jpg') }) });
	assert.equal(r.best?.assetId, 'b', JSON.stringify(r));
	assert.ok(r.best!.distance <= 0.004);
	assert.equal(r.accepted, true);
	assert.deepEqual(r.ranked.map((x) => x.assetId).slice(1).sort(), ['a', 'c']);
	assert.equal(r.ranked[0].assetId, 'b');
});

test('findInImmich ranks a lone far candidate but does not accept it, and rejects an unknown key', async () => {
	const root = await setup();
	const r = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich: stub({ a: load('meadow-hut.jpg') }) });
	assert.equal(r.accepted, false);
	assert.equal(r.best?.assetId, 'a');
	assert.equal(r.ranked.length, 1);
	await assert.rejects(findInImmich(root, REF, 'nope.jpg', { immich: stub({}) }), /No such photo/);
});

test('POST /api/photos/link stores the link for a known key only', async () => {
	const root = await setup();
	const api = createApi(root, defaultRoutes({ immich: () => stub({}) }));
	const r = (json: unknown): ApiRequest => ({ method: 'POST', path: '/api/photos/link', query: new URLSearchParams(`slug=setzberg&date=${DATE}`), headers: {}, json });
	assert.equal((await api(r({ key: `${DATE}-00.jpg`, assetId: UUID }))).status, 200);
	assert.equal(readLinks(root)[`${DATE}-setzberg.md`][`${DATE}-00.jpg`], UUID);
	assert.equal((await api(r({ key: 'nope.jpg', assetId: UUID }))).status, 404);
	assert.equal((await api(r({ key: `${DATE}-00.jpg`, assetId: 'b' }))).status, 400);
});

// A textured, photo-like image: seeded noise over a gradient, softened.
async function textured(seed: number, w = 480, h = 320): Promise<Buffer> {
	let x = seed;
	const px = Buffer.alloc(w * h * 3);
	for (let i = 0; i < w * h; i++) {
		const gx = (i % w) / w, gy = Math.floor(i / w) / h;
		for (let c = 0; c < 3; c++) {
			x = (x * 1664525 + 1013904223) >>> 0;
			px[i * 3 + c] = Math.max(0, Math.min(255, 60 + 120 * (c === 0 ? gx : c === 1 ? gy : (gx + gy) / 2) + ((seed * 37 + c * 50) % 60) + ((x >>> 24) - 128) * 0.5));
		}
	}
	return sharp(px, { raw: { width: w, height: h, channels: 3 } }).blur(1.2).png().toBuffer();
}

test('findInImmich ranks an AVIF q50 tier vs a WebP q60 thumbnail of another size first among decoys', async () => {
	const root = await setup();
	const dir = path.join(root, 'static/images/projects/data-viz/hikes/stories/setzberg');
	const src = await textured(1);
	for (const t of ['640', '1280']) fs.rmSync(path.join(dir, `${DATE}-00-${t}.avif`), { force: true });
	await sharp(src).avif({ quality: 50 }).toFile(path.join(dir, `${DATE}-00-640.avif`));
	const thumb = await sharp(src).resize(250).webp({ quality: 60 }).toBuffer();
	const r = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich: stub({ d1: await sharp(await textured(2)).jpeg().toBuffer(), good: thumb, d3: await sharp(await textured(3)).jpeg().toBuffer() }) });
	assert.equal(r.ranked[0].assetId, 'good', JSON.stringify(r.ranked));
	assert.equal(r.best?.assetId, 'good');
});

test('findInImmich: album=none with a wider window finds what the default misses', async () => {
	const root = await setup();
	const far: Asset = { ...asset('far'), takenLocal: '2026-01-20T10:00:00+01:00' };
	const copy = await sharp(load('sky-ridge.jpg')).resize(360).jpeg({ quality: 85 }).toBuffer();
	const immich = {
		albums: async () => [],
		search: async (q: { takenAfter?: string; takenBefore?: string }) => [far].filter((a) => (!q.takenAfter || Date.parse(a.takenLocal) >= Date.parse(q.takenAfter)) && (!q.takenBefore || Date.parse(a.takenLocal) <= Date.parse(q.takenBefore))),
		thumb: async () => copy
	} as unknown as Immich;
	const key = `${DATE}-00.jpg`;
	assert.equal((await findInImmich(root, REF, key, { immich })).ranked.length, 0);
	const wide = await findInImmich(root, REF, key, { immich, album: 'none', from: '2026-01-01', to: '2026-01-31' });
	assert.equal(wide.best?.assetId, 'far');
	assert.equal(wide.accepted, true);
});

test('findInImmich accepts a loose match (<= 0.015) only with a clear margin', async () => {
	const root = await setup();
	const near = await sharp(load('sky-ridge.jpg')).modulate({ brightness: 1.03 }).jpeg().toBuffer();
	const r = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich: stub({ n: near, m: load('meadow-hut.jpg') }) });
	assert.ok(r.best!.distance > 0.004 && r.best!.distance <= 0.015, String(r.best?.distance));
	assert.equal(r.accepted, true);
	const twin = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich: stub({ n: near, n2: near }) });
	assert.equal(twin.accepted, false);
});

test('findInImmich sorts different-shaped candidates after same-shaped ones before the cut', async () => {
	const root = await setup();
	const tall = await sharp(load('sky-ridge.jpg')).resize(100, 300, { fit: 'fill' }).jpeg().toBuffer();
	const copy = await sharp(load('sky-ridge.jpg')).resize(360).jpeg({ quality: 85 }).toBuffer();
	const immich = { albums: async () => [], search: async () => [{ ...asset('t'), width: 100, height: 300 }, asset('s')], thumb: async (id: string) => (id === 't' ? tall : copy) } as unknown as Immich;
	const r = await findInImmich(root, REF, `${DATE}-00.jpg`, { immich });
	assert.deepEqual(r.ranked.map((x) => x.assetId), ['s', 't']);
});

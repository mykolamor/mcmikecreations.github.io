import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodeImage, encodeTiersTo, localImageRefs } from './images';
import { heicColour } from '../server/files';
import { avifVariantHref } from '../../../src/lib/renderers/responsive-image';

const dir = mkdtempSync(join(tmpdir(), 'images-'));
const landscape = join(dir, 'land.jpg');
const rotated = join(dir, 'rot.jpg');
const small = join(dir, 'small.jpg');

const make = (w: number, h: number) =>
	sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 160, b: 90 } } }).jpeg();
const tier = (src: string, t: number) => avifVariantHref(src, t);
async function dims(p: string) {
	const m = await sharp(p).metadata();
	return [m.width, m.height];
}

before(async () => {
	await make(3000, 2000).toFile(landscape);
	await make(3000, 2000).withMetadata({ orientation: 6 }).toFile(rotated);
	await make(800, 600).toFile(small);
});

test('tiers by long edge, no upscaling, quality pipeline', async () => {
	const r = await encodeImage(landscape);
	assert.deepEqual([r.w, r.h, r.tiers], [3000, 2000, [640, 1280, 2560]]);
	assert.deepEqual(await dims(tier(landscape, 1280)), [1280, 853]);
	assert.match(r.blur, /^data:image\/webp;base64,/);
});

test('EXIF-rotated portrait reports oriented size', async () => {
	const r = await encodeImage(rotated);
	assert.deepEqual([r.w, r.h], [2000, 3000]);
	assert.deepEqual(await dims(tier(rotated, 640)), [427, 640]);
});

test('small image gets only fitting tiers', async () => {
	assert.deepEqual((await encodeImage(small)).tiers, [640]);
});

test('localImageRefs skips 404, remote and video', () => {
	assert.deepEqual(
		localImageRefs('![a](/images/hikes/topo/kofel.jpg)\n![b](/404/)\n![c](https://x/y.jpg)\n![d](/images/s/v.mp4)'),
		['/images/hikes/topo/kofel.jpg']
	);
});

const HEIC = join(__dirname, '../data/fixtures/sample.heic');

test('encodeTiersTo writes the tiers for the target href and never the original', async () => {
	const root = mkdtempSync(join(tmpdir(), 'tiers-'));
	const src = await make(3000, 2000).withMetadata({ orientation: 6 }).toBuffer();
	const r = await encodeTiersTo(src, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg', root);
	assert.deepEqual([r.w, r.h, r.tiers], [2000, 3000, [640, 1280, 2560]]);
	const dir = join(root, 'static/images/projects/data-viz/hikes/stories/foo');
	assert.deepEqual(readdirSync(dir).sort(), ['2024-01-01-00-1280.avif', '2024-01-01-00-2560.avif', '2024-01-01-00-640.avif']);
	assert.deepEqual(await dims(join(dir, '2024-01-01-00-640.avif')), [427, 640]);
	assert.match(r.blur, /^data:image\/webp;base64,/);
});

test('encodeTiersTo refuses a target outside static/images', async () => {
	const root = mkdtempSync(join(tmpdir(), 'tiers-'));
	await assert.rejects(encodeTiersTo(await make(800, 600).toBuffer(), '/images/../../etc/x.jpg', root));
	await assert.rejects(encodeTiersTo(await make(800, 600).toBuffer(), '/_projects/x.jpg', root));
});

test('HEIC tiers keep the ICC profile', { skip: existsSync(HEIC) ? false : 'scripts/crm/data/fixtures/sample.heic is missing (run scripts/crm/fetch-fixtures.ts)' }, async () => {
	const root = mkdtempSync(join(tmpdir(), 'tiers-'));
	const heic = readFileSync(HEIC);
	const src = heicColour(heic).icc!;
	const r = await encodeTiersTo(heic, '/images/hikes/x/IMG.jpg', root);
	assert.ok(r.tiers.length > 0);
	for (const t of r.tiers) {
		const m = await sharp(join(root, 'static/images/hikes/x', `IMG-${t}.avif`)).metadata();
		assert.ok(m.icc, `tier ${t} has an ICC profile`);
		assert.equal(m.icc!.subarray(36, 40).toString('latin1'), 'acsp');
		// same profile description as the source (no sRGB conversion)
		assert.equal(m.icc!.subarray(12, 20).toString('latin1'), src.subarray(12, 20).toString('latin1'));
		assert.ok(m.icc!.equals(src), 'tier profile is the source profile');
	}
});

test('an AVIF (mif1 with avif compatible brand) is not decoded as HEIC', async () => {
	const root = mkdtempSync(join(tmpdir(), 'tiers-'));
	const avif = await make(1000, 800).avif().toBuffer();
	// rewrite the major brand to mif1, keeping 'avif' among the compatible brands
	const patched = Buffer.from(avif);
	patched.write('mif1', 8, 'latin1');
	assert.ok(patched.subarray(16, patched.readUInt32BE(0)).toString('latin1').includes('avif'));
	const r = await encodeTiersTo(patched, '/images/x/a.jpg', root);
	assert.deepEqual([r.w, r.h], [1000, 800]);
});

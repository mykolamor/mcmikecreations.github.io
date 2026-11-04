import { access, mkdir, rename, unlink } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { decodeHeic } from '../server/files';
import { avifTiers, avifVariantHref, tierDimensions } from '../../../src/lib/renderers/responsive-image';

// sharp runs libvips on one thread on glibc Linux without jemalloc (against memory fragmentation in long-lived servers),
// which makes AVIF tiers of a 50 MP photo take ~16 s instead of ~4 s. The CRM is a local tool: every core is fair game.
sharp.concurrency(availableParallelism());

const AVIF_QUALITY = 50;
const BLUR_LONG_EDGE = 24;
const BLUR_QUALITY = 50;

export interface EncodedImage {
	w: number;
	h: number;
	blur: string;
	tiers: number[];
}

async function existingDims(path: string): Promise<[number, number] | null> {
	try {
		await access(path);
		const m = await sharp(path).metadata();
		return m.width && m.height ? [m.width, m.height] : null;
	} catch {
		return null;
	}
}

/**
 * Writes the AVIF tiers (640/1280/2560 by long edge, never upscaled) next to `srcPath`,
 * skipping tiers already present with the right size, and returns the EXIF-oriented
 * dimensions, the WebP blur data URI and the tier targets.
 */
export async function encodeImage(srcPath: string): Promise<EncodedImage> {
	const meta = await sharp(srcPath).metadata();
	if (!meta.width || !meta.height) throw new Error(`cannot read dimensions of ${srcPath}`);
	const swap = (meta.orientation ?? 1) >= 5;
	const w = swap ? meta.height : meta.width;
	const h = swap ? meta.width : meta.height;

	const tiers: number[] = [];
	for (const { target } of avifTiers(w, h)) {
		const dims = tierDimensions(w, h, target)!;
		const out = avifVariantHref(srcPath, target);
		const have = await existingDims(out);
		if (!have || have[0] !== dims.width || have[1] !== dims.height) {
			await sharp(srcPath)
				.rotate()
				.resize({ width: dims.width, height: dims.height, fit: 'fill', kernel: 'lanczos3' })
				.avif({ quality: AVIF_QUALITY })
				.toFile(out);
		}
		tiers.push(target);
	}

	const long = Math.max(w, h);
	const scale = Math.min(1, BLUR_LONG_EDGE / long);
	const buf = await sharp(srcPath)
		.rotate()
		.resize({
			width: Math.max(1, Math.round(w * scale)),
			height: Math.max(1, Math.round(h * scale)),
			fit: 'fill',
			kernel: 'lanczos3'
		})
		.webp({ quality: BLUR_QUALITY })
		.toBuffer();
	return { w, h, blur: `data:image/webp;base64,${buf.toString('base64')}`, tiers };
}

/** ISO-BMFF with a HEIF brand and no AVIF brand: sharp's prebuilt libheif has no HEVC decoder, so these go through heic-decode. */
function isHeic(buf: Buffer): boolean {
	if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp') return false;
	const end = Math.min(buf.readUInt32BE(0), buf.length);
	const brands = [buf.toString('latin1', 8, 12)];
	for (let p = 16; p + 4 <= end; p += 4) brands.push(buf.toString('latin1', p, p + 4));
	if (brands.some((b) => b === 'avif' || b === 'avis')) return false;
	return brands.some((b) => /^(hei[cxms]|hev[cxms]|mif1|msf1)$/.test(b));
}

/**
 * Writes only the AVIF tiers of `targetHref` (a `/images/…` href; its file itself is never written) from an image
 * buffer or file. HEIC keeps its colour profile in the tiers (no sRGB conversion); other formats are encoded like
 * `encodeImage`. Existing tiers of the same name are replaced, or with `skipExisting` kept untouched (still listed in `tiers`). Returns the oriented size, blur and tier targets.
 */
export async function encodeTiersTo(source: Buffer | string, targetHref: string, root: string, opts: { skipExisting?: boolean } = {}): Promise<EncodedImage> {
	const imagesDir = path.resolve(root, 'static', 'images');
	const target = path.resolve(root, 'static', String(targetHref).replace(/^\/+/, ''));
	if (!String(targetHref).startsWith('/images/') || !target.startsWith(imagesDir + path.sep)) throw new Error(`target ${targetHref} is outside static/images`);

	const buf = typeof source === 'string' ? null : source;
	const heic = buf !== null && isHeic(buf);
	const input: Buffer | string = heic ? await decodeHeic(buf!) : source;
	const meta = await sharp(input).metadata();
	if (!meta.width || !meta.height) throw new Error('cannot read the image dimensions');
	const swap = (meta.orientation ?? 1) >= 5;
	const w = swap ? meta.height : meta.width;
	const h = swap ? meta.width : meta.height;

	await mkdir(path.dirname(target), { recursive: true });
	const written: string[] = [];
	const renamed: string[] = [];
	const tiers: number[] = [];
	const encoded: number[] = [];
	try {
		for (const { target: t, width, height } of avifTiers(w, h)) {
			let img = sharp(input).rotate().resize({ width, height, fit: 'fill', kernel: 'lanczos3' });
			if (heic) img = img.keepIccProfile();
			const out = avifVariantHref(target, t);
			if (opts.skipExisting && (await access(out).then(() => true, () => false))) {
				tiers.push(t);
				continue;
			}
			const tmp = `${out}.${process.pid}.tmp`;
			written.push(tmp);
			await img.avif({ quality: AVIF_QUALITY }).toFile(tmp);
			encoded.push(t);
			tiers.push(t);
		}
		for (const t of encoded) {
			await rename(`${avifVariantHref(target, t)}.${process.pid}.tmp`, avifVariantHref(target, t));
			renamed.push(avifVariantHref(target, t));
		}
	} catch (e) {
		// a half-renamed set is worse than none: drop the temp files and the tiers already moved into place
		for (const f of [...written, ...renamed]) await unlink(f).catch(() => undefined);
		throw e;
	}

	const scale = Math.min(1, BLUR_LONG_EDGE / Math.max(w, h));
	const blur = await sharp(input)
		.rotate()
		.resize({ width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), fit: 'fill', kernel: 'lanczos3' })
		.webp({ quality: BLUR_QUALITY })
		.toBuffer();
	return { w, h, blur: `data:image/webp;base64,${blur.toString('base64')}`, tiers };
}

/** Oriented size and WebP blur data URI of an image, without writing anything. */
export async function imageBlur(source: Buffer | string): Promise<{ w: number; h: number; blur: string }> {
	const meta = await sharp(source).metadata();
	if (!meta.width || !meta.height) throw new Error('cannot read the image dimensions');
	const swap = (meta.orientation ?? 1) >= 5;
	const w = swap ? meta.height : meta.width;
	const h = swap ? meta.width : meta.height;
	const scale = Math.min(1, BLUR_LONG_EDGE / Math.max(w, h));
	const buf = await sharp(source)
		.rotate()
		.resize({ width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), fit: 'fill', kernel: 'lanczos3' })
		.webp({ quality: BLUR_QUALITY })
		.toBuffer();
	return { w, h, blur: `data:image/webp;base64,${buf.toString('base64')}` };
}

const IMAGE_LINE = /!\[[^\]]*\]\((\/images\/[^)\s]+\.(?:jpe?g|png|webp))(?:\s+"[^"]*")?\)/gi;

/** Local image hrefs (`/images/….jpg|jpeg|png|webp`) referenced by markdown image syntax, in order, unique. */
export function localImageRefs(markdownBody: string): string[] {
	const out: string[] = [];
	for (const m of markdownBody.matchAll(IMAGE_LINE)) {
		if (m[1].includes('/404/')) continue;
		if (!out.includes(m[1])) out.push(m[1]);
	}
	return out;
}

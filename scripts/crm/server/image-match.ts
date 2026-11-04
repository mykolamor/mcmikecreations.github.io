// Find a repo photo in Immich: perceptual hash (pHash) shortlists, block-mean RGB decides. Port of the former scripts/matches/signatures.py
// (phash, block_mean, distances) and the stage-2 cascade of the former scripts/matches/matcher.py (top 15 by pHash, accept block-mean <= 0.004).
// Resampling: PIL LANCZOS and libvips lanczos3 both low-pass before decimating but differ slightly in rounding, so hashes can
// differ by a bit or two from Python's; the golden test allows <= 2 bits and 0.003 mean block difference.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { AVIF_TIERS, avifVariantHref } from '../../../src/lib/renderers/responsive-image';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { ApiError } from './errors';
import { served } from './files';
import type { Immich } from './immich-client';
import { docFile, ownFolder, type DocRef, type EnglishRef } from './doc-ref';
import { repoPaths } from './paths';
import { candidates } from './photo-sources';
import { isMap } from 'yaml';

const PHASH_SIZE = 8;
const PHASH_FACTOR = 4;
const BLOCK_MEAN_GRID = 8;
export const PHASH_TOP_K = 15;
export const BM_ACCEPT = 0.004;
const WORKERS = 8;

const N = PHASH_SIZE * PHASH_FACTOR;
// Orthonormal DCT-II basis, as scipy.fftpack.dct(norm="ortho").
const BASIS = Array.from({ length: PHASH_SIZE }, (_, k) => Array.from({ length: N }, (_, n) => Math.sqrt((k === 0 ? 1 : 2) / N) * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N))));

const raw = (buf: Buffer, size: number, fit: 'fill') => sharp(buf).removeAlpha().toColourspace('srgb').resize(size, size, { fit, kernel: 'lanczos3' }).raw().toBuffer();

/** 63-bit hash: bit i is set when the i-th (DC dropped) low-frequency DCT coefficient of the 32x32 grey image exceeds the median. */
export async function phash(buf: Buffer): Promise<bigint> {
	const rgb = await raw(buf, N, 'fill');
	const grey = new Float64Array(N * N);
	for (let i = 0; i < N * N; i++) grey[i] = Math.round((299 * rgb[i * 3] + 587 * rgb[i * 3 + 1] + 114 * rgb[i * 3 + 2]) / 1000); // PIL "L" (ITU-R 601-2)
	// rows (axis 1) then columns (axis 0); only the top-left PHASH_SIZE^2 block is needed
	const rows = Array.from({ length: N }, (_, y) => BASIS.map((b) => b.reduce((s, c, x) => s + c * grey[y * N + x], 0)));
	const block: number[] = [];
	for (let u = 0; u < PHASH_SIZE; u++) for (let v = 0; v < PHASH_SIZE; v++) block.push(BASIS[u].reduce((s, c, y) => s + c * rows[y][v], 0));
	const coeffs = block.slice(1);
	const median = [...coeffs].sort((a, b) => a - b)[(coeffs.length - 1) / 2]; // 63 values: the middle one
	let h = 0n;
	coeffs.forEach((c, i) => {
		if (c > median) h |= 1n << BigInt(i);
	});
	return h;
}

export function hamming(a: bigint, b: bigint): number {
	let x = a ^ b;
	let n = 0;
	for (; x; x &= x - 1n) n++;
	return n;
}

/** 8x8 RGB grid means scaled to 0..1, flattened (192 values). */
export async function blockMean(buf: Buffer): Promise<Float32Array> {
	const rgb = await raw(buf, BLOCK_MEAN_GRID, 'fill');
	return Float32Array.from(rgb, (v) => v / 255);
}

export function blockMeanDistance(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
	return s / a.length;
}

export type Match = { assetId: string; distance: number; hamming: number };
/** `ranked`: up to 15 candidates, closest block-mean first; `best` = ranked[0]; `accepted` is only a hint (linking is confirmed separately). */
export type FindResult = { best?: { assetId: string; distance: number }; accepted: boolean; ranked: Match[] };
/** `query`: the smart-search text for a place doc (default its title). */
export type FindOptions = { immich: Immich; album?: string; from?: string | null; to?: string | null; query?: string | null };

/** The photo's pixels: the largest AVIF tier present, else the original file (rotated upright). */
async function photoBytes(root: string, href: string): Promise<Buffer> {
	const abs = served(root, href, '/images/', path.join(repoPaths(root).static, 'images'));
	if (!abs) throw new ApiError(400, `Not an image under static/images: ${href}`);
	for (const t of [...AVIF_TIERS].reverse()) {
		const f = avifVariantHref(abs, t);
		if (existsSync(f)) return readFileSync(f);
	}
	if (existsSync(abs)) return sharp(readFileSync(abs)).rotate().jpeg({ quality: 95 }).toBuffer();
	throw new ApiError(404, `No image file for ${href}`);
}

async function pool<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	}));
	return out;
}

const SHAPE_TOL = 0.15; // abs(log aspect ratio) beyond which a candidate is a different shape
const LOOSE_ACCEPT = 0.015;
const LOOSE_MARGIN = 2;

/** The doc's `images` node (refs come validated from refFromQuery). */
function imagesOf(root: string, ref: DocRef) {
	const file = docFile(root, ref);
	if (!file) throw new ApiError(400, 'Photos belong to a post (a dated visit) or a place doc');
	try {
		return readFrontmatterDoc(readFileSync(file, 'utf8')).doc.get('images', true);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, `No such ${ref.kind === 'place' ? 'place doc' : 'post'}: ${path.basename(file)}`);
		throw e;
	}
}

/**
 * Compares a photo of the doc with the thumbnails of its Immich candidates: a post's window (and guessed album),
 * a place doc's smart search; `album`/`from`/`to`/`query` widen or change the search.
 */
export async function findInImmich(root: string, ref: EnglishRef, key: string, deps: FindOptions): Promise<FindResult> {
	const images = imagesOf(root, ref);
	if (!isMap(images) || !images.has(key)) throw new ApiError(404, `No such photo: ${key}`);
	const href = key.startsWith('/') ? key : ownFolder(ref) + key;
	const bytes = await photoBytes(root, href);
	const meta = await sharp(bytes).metadata();
	const qAspect = meta.width && meta.height ? meta.width / meta.height : 0;
	const [qHash, qMean] = await Promise.all([phash(bytes), blockMean(bytes)]);

	const found = await candidates(root, deps.immich, { ref, album: deps.album || 'guess', from: deps.from, to: deps.to, query: deps.query });
	const assets = found.bursts.flatMap((b) => b.assets);
	const hashed = (await pool(assets, async (a) => {
		try {
			const t = await deps.immich.thumb(a.id, 'thumbnail');
			const odd = qAspect > 0 && a.width > 0 && a.height > 0 && Math.abs(Math.log(a.width / a.height / qAspect)) > SHAPE_TOL;
			return { id: a.id, t, odd, hash: await phash(t) };
		} catch {
			return null; // an unreadable thumbnail is simply not a candidate
		}
	})).filter((x): x is { id: string; t: Buffer; odd: boolean; hash: bigint } => !!x);
	const top = hashed
		.map((x) => ({ ...x, hamming: hamming(qHash, x.hash) }))
		.sort((a, b) => Number(a.odd) - Number(b.odd) || a.hamming - b.hamming || (a.id < b.id ? -1 : 1))
		.slice(0, PHASH_TOP_K);
	const ranked: Match[] = [];
	for (const x of top) ranked.push({ assetId: x.id, hamming: x.hamming, distance: blockMeanDistance(qMean, await blockMean(x.t)) });
	ranked.sort((a, b) => a.distance - b.distance || a.hamming - b.hamming);
	const [first, second] = ranked;
	const accepted = !!first && (first.distance <= BM_ACCEPT || (first.distance <= LOOSE_ACCEPT && (!second || second.distance >= LOOSE_MARGIN * first.distance)));
	return { ...(first ? { best: { assetId: first.assetId, distance: first.distance } } : {}), accepted, ranked };
}

/** True when `key` is an `images` entry of the doc. */
export function hasPhotoKey(root: string, ref: DocRef, key: string): boolean {
	const images = imagesOf(root, ref);
	return isMap(images) && images.has(key);
}

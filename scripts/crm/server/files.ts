import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { parse } from 'jsonc-parser';
import sharp from 'sharp';
import { defaultFilePath, defaultGpxPath } from '../../../src/lib/data/hikes-core.js';
import { editFrontmatter, readFrontmatterDoc } from '../lib/frontmatter';
import { setFrontmatterValue } from '../shared/ops';
import { ApiError } from './errors';
import { postPath, sidecarPath, versionOf, writeAllAtomic } from './doc';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { editSidecar } from './sidecar-file';

export type FilesState = {
	cover: { path: string; w: number; h: number; bytes: number; thumbOk: boolean } | null;
	gpx: { path: string; km: number } | null;
	geojson: { path: string; km: number } | null;
	bailouts: { route: string; at: string; km: number | null }[];
	/** True for a route's first post (or no post): its default cover is the hike cover. */
	firstPost: boolean;
};

const IMAGE_URL = '/images/projects/data-viz/hikes/';
const GPX_URL = '/_projects/data-viz/hikes/gpx/';
const GEOJSON_URL = '/_projects/data-viz/hikes/geojson/';
const THUMB_W = 400;
const THUMB_H = 300;

// ---------------------------------------------------------------- helpers

export { writeAllAtomic };

function bad(msg: string): ApiError {
	return new ApiError(400, msg);
}

function haversineKm(a: [number, number], b: [number, number]): number {
	const rad = Math.PI / 180;
	const dLat = (b[1] - a[1]) * rad;
	const dLon = (b[0] - a[0]) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
	return 12742 * Math.asin(Math.sqrt(h));
}

function lengthKm(pts: [number, number][]): number {
	let km = 0;
	for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
	return Math.round(km * 100) / 100;
}

/** Track points `[lon, lat]` of a GPX text (all trkpt, in order). */
function gpxPoints(text: string): [number, number][] {
	if (!/<gpx[\s>]/.test(text)) return [];
	const pts: [number, number][] = [];
	for (const m of text.matchAll(/<trkpt\b([^>]*)>/g)) {
		const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(m[1]);
		const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(m[1]);
		if (lat && lon && Number.isFinite(+lat[1]) && Number.isFinite(+lon[1])) pts.push([+lon[1], +lat[1]]);
	}
	return pts;
}

function validateGpx(file: Buffer): number {
	const pts = gpxPoints(file.toString('utf8'));
	if (pts.length < 2) throw bad('Not a GPX track: need at least 2 track points');
	return lengthKm(pts);
}

function geojsonLine(text: string): [number, number][] | null {
	let v: any;
	try {
		v = JSON.parse(text);
	} catch {
		return null;
	}
	if (v?.type !== 'FeatureCollection' || !Array.isArray(v.features)) return null;
	for (const f of v.features) {
		const g = f?.geometry;
		if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) return g.coordinates.map((c: number[]) => [c[0], c[1]]);
	}
	return null;
}

/** Served path (`/images/...`, `/_projects/...`) to an absolute file under `base`, or null when it escapes it. */
export function served(root: string, url: string, prefix: string, base: string): string | null {
	if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
	const abs = path.resolve(repoPaths(root).static, url.slice(1));
	return abs.startsWith(path.resolve(base) + path.sep) ? abs : null;
}

/** Dates of the posts `<date>-<slug>.md`, ascending. */
function postDates(root: string, slug: string): string[] {
	const dir = repoPaths(root).markdown;
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const f of readdirSync(dir)) {
		const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(f);
		if (m && m[2] === slug) out.push(m[1]);
	}
	return out.sort();
}

export function isFirstPost(root: string, slug: string, date: string): boolean {
	return !postDates(root, slug).some((d) => d < date);
}

function postFront(root: string, slug: string, date: string): any {
	const pp = postPath(root, slug, date);
	if (!existsSync(pp)) throw new ApiError(404, `No post ${date}-${slug}`);
	return (readFrontmatterDoc(readFileSync(pp, 'utf8')).doc.toJS() ?? {}) as any;
}

/** `<slug><ext>` for a first visit, else `<slug>_<YYYY><ext>`, else `<slug>_<date><ext>`; a taken name is never returned (the date form is the last resort). */
function pickName(slug: string, date: string, first: boolean, taken: (name: string) => boolean, ext: string): string {
	const byYear = `${slug}_${date.slice(0, 4)}${ext}`;
	const candidates = [...(first ? [slug + ext] : []), byYear];
	return candidates.find((n) => !taken(n)) ?? `${slug}_${date}${ext}`;
}

/** The GPX URL a post links like the site does: front matter `gpx`, else the default path next to its route GeoJSON when that file exists. */
export function resolveGpxUrl(root: string, slug: string, front: any): { url: string; explicit: boolean } | null {
	if (typeof front.gpx === 'string') return { url: front.gpx, explicit: true };
	const url = defaultGpxPath(typeof front.filePath === 'string' ? front.filePath : defaultFilePath(slug));
	const f = served(root, url, GPX_URL, repoPaths(root).gpx);
	return f && existsSync(f) ? { url, explicit: false } : null;
}

/** GPX URLs the other posts (any slug) link, explicitly or by the site's default. */
function gpxUsedByOthers(root: string, slug: string, date: string): Set<string> {
	const dir = repoPaths(root).markdown;
	const out = new Set<string>();
	if (!existsSync(dir)) return out;
	for (const f of readdirSync(dir)) {
		const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(f);
		if (!m || (m[1] === date && m[2] === slug)) continue;
		let front: any;
		try {
			front = readFrontmatterDoc(readFileSync(path.join(dir, f), 'utf8')).doc.toJS() ?? {};
		} catch {
			continue;
		}
		const r = resolveGpxUrl(root, m[2], front);
		if (r) out.add(r.url);
	}
	return out;
}

// ---------------------------------------------------------------- colour

type Box = { type: string; start: number; body: number; end: number };

function boxes(buf: Buffer, from: number, to: number): Box[] {
	const out: Box[] = [];
	let p = from;
	while (p + 8 <= to) {
		let size = buf.readUInt32BE(p);
		const type = buf.toString('latin1', p + 4, p + 8);
		let body = p + 8;
		if (size === 1) {
			size = Number(buf.readBigUInt64BE(p + 8));
			body = p + 16;
		} else if (size === 0) size = to - p;
		if (size < body - p || p + size > to) break;
		out.push({ type, start: p, body, end: p + size });
		p += size;
	}
	return out;
}

export type HeicColour = { icc: Buffer | null; primaries: number | null };

/** The first `colr` property of a HEIC (meta > iprp > ipco): an embedded ICC profile, else the nclx primaries code. */
export function heicColour(buf: Buffer): HeicColour {
	const meta = boxes(buf, 0, buf.length).find((b) => b.type === 'meta');
	const res: HeicColour = { icc: null, primaries: null };
	if (!meta) return res;
	const iprp = boxes(buf, meta.body + 4, meta.end).find((b) => b.type === 'iprp');
	const ipco = iprp && boxes(buf, iprp.body, iprp.end).find((b) => b.type === 'ipco');
	if (!ipco) return res;
	for (const c of boxes(buf, ipco.body, ipco.end)) {
		if (c.type !== 'colr') continue;
		const kind = buf.toString('latin1', c.body, c.body + 4);
		if ((kind === 'prof' || kind === 'rICC') && !res.icc) res.icc = Buffer.from(buf.subarray(c.body + 4, c.end));
		else if (kind === 'nclx' && res.primaries === null) res.primaries = buf.readUInt16BE(c.body + 4);
	}
	return res;
}

function chunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
	return Buffer.concat([head, data, crc]);
}

/** Inserts an iCCP chunk (tagging the pixels with `icc` without converting them) after IHDR. */
export function tagPng(png: Buffer, icc: Buffer): Buffer {
	const ihdrEnd = 8 + 8 + 13 + 4;
	const data = Buffer.concat([Buffer.from('icc\0\0', 'latin1'), deflateSync(icc)]);
	return Buffer.concat([png.subarray(0, ihdrEnd), chunk('iCCP', data), png.subarray(ihdrEnd)]);
}

/** Any image carrying an ICC profile to a quality-90 sRGB JPEG. */
export async function pngToSrgbJpeg(png: Buffer): Promise<Buffer> {
	return sharp(png).toColourspace('srgb').jpeg({ quality: 90 }).toBuffer();
}

/** Decodes a HEIC/HEIF into a lossless PNG tagged (not converted) with its colour profile: the embedded ICC, else one for the nclx primaries. */
export async function decodeHeic(file: Buffer): Promise<Buffer> {
	const { default: decode } = await import('heic-decode');
	let img;
	try {
		img = await decode({ buffer: file });
	} catch (e) {
		throw bad(`Could not decode the HEIC image: ${e instanceof Error ? e.message : String(e)}`);
	}
	const colour = heicColour(file);
	let icc = colour.icc;
	if (!icc) {
		// nclx primaries: 12 = Display P3, 1 = BT.709 (sRGB); anything else is treated as sRGB
		const name = colour.primaries === 12 ? 'p3' : 'srgb';
		icc = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
			.withIccProfile(name)
			.jpeg()
			.toBuffer()
			.then(async (j) => (await sharp(j).metadata()).icc ?? null);
	}
	const png = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
		.removeAlpha()
		.png({ compressionLevel: 1 })
		.toBuffer();
	return icc ? tagPng(png, icc) : png;
}

async function heicToSrgbJpeg(file: Buffer): Promise<Buffer> {
	return pngToSrgbJpeg(await decodeHeic(file));
}

async function thumbOf(jpeg: Buffer): Promise<Buffer> {
	return sharp(jpeg)
		.rotate()
		.resize(THUMB_W, THUMB_H, { fit: 'inside', withoutEnlargement: false })
		.jpeg({ quality: 50, progressive: true, chromaSubsampling: '4:2:0' })
		.toBuffer();
}

/** `static/images/projects/data-viz/hikes/thumb/<name>.jpg` from an image path (absolute or under `static`). */
export async function writeThumb(root: string, imagePath: string): Promise<void> {
	const src = path.isAbsolute(imagePath) ? imagePath : path.join(repoPaths(root).static, imagePath);
	const out = path.join(repoPaths(root).thumbs, path.basename(src));
	writeAllAtomic([[out, await thumbOf(readFileSync(src))]]);
}

/** Rebuilds the thumbnail of the cover `filesState` shows for this hike/post; 404 when there is no cover. */
export async function rebuildThumb(root: string, slug: string, date: string | null): Promise<void> {
	const st = await filesState(root, slug, date);
	if (!st.cover) throw new ApiError(404, 'No cover image to make a thumbnail from');
	const abs = served(root, st.cover.path, IMAGE_URL, repoPaths(root).images);
	if (!abs) throw bad('Cover is outside the images folder');
	await writeThumb(root, abs);
}

// ---------------------------------------------------------------- writers

export type CoverScope = 'hike' | 'post';

/** `scope` null picks the default: the hike cover for a route's first post, a per-post cover for later visits. */
export async function writeCover(root: string, slug: string, file: Buffer, filename: string, scope: CoverScope | null, date: string | null): Promise<void> {
	assertSafeSlug(slug);
	if (date !== null) assertSafeDate(date);
	const p = repoPaths(root);
	const ext = path.extname(filename ?? '').toLowerCase();
	let jpeg: Buffer;
	if (ext === '.jpg' || ext === '.jpeg') {
		try {
			await sharp(file).metadata();
		} catch {
			throw bad('Not a valid JPEG image');
		}
		jpeg = file;
	} else if (ext === '.heic' || ext === '.heif') jpeg = await heicToSrgbJpeg(file);
	else throw bad('Cover must be a .jpg, .jpeg, .heic or .heif file');
	let thumb: Buffer;
	try {
		thumb = await thumbOf(jpeg);
	} catch {
		throw bad('Could not read the image');
	}

	const sc: CoverScope = scope ?? (date === null || isFirstPost(root, slug, date) ? 'hike' : 'post');
	if (sc === 'post' && date === null) throw bad('A per-post cover needs a post date');
	const sp = sidecarPath(root, slug);
	if (!existsSync(sp)) throw new ApiError(404, `No sidecar for ${slug}`);

	let name: string;
	if (sc === 'hike') name = `${slug}.jpg`;
	else {
		const cur = postFront(root, slug, date!).image;
		const existing = typeof cur === 'string' ? served(root, cur, IMAGE_URL, p.images) : null;
		name = existing && path.dirname(existing) === path.resolve(p.images) && path.basename(existing) !== `${slug}.jpg` ? path.basename(existing) : pickName(slug, date!, false, (n) => existsSync(path.join(p.images, n)), '.jpg');
	}
	writeAllAtomic([
		[path.join(p.images, name), jpeg],
		[path.join(p.thumbs, name), thumb]
	]);
	const url = IMAGE_URL + name;
	if (sc === 'hike') {
		const raw = readFileSync(sp, 'utf8');
		const cur = (parse(raw) as any)?.image;
		if (cur !== url) writeAllAtomic([[sp, editSidecar(raw, [{ path: ['image'], value: url }])]]);
	} else await setPostKey(root, slug, date!, 'image', url);
}

async function setPostKey(root: string, slug: string, date: string, key: string, value: string): Promise<void> {
	await editFrontmatter(postPath(root, slug, date), (doc) => {
		if (doc.get(key) !== value) setFrontmatterValue(doc, [key], value);
	});
}

export async function writeGpx(root: string, slug: string, date: string, file: Buffer): Promise<void> {
	assertSafeSlug(slug);
	assertSafeDate(date);
	validateGpx(file);
	const p = repoPaths(root);
	const cur = resolveGpxUrl(root, slug, postFront(root, slug, date));
	const others = gpxUsedByOthers(root, slug, date);
	const existing = cur && (cur.explicit || !others.has(cur.url)) ? served(root, cur.url, GPX_URL, p.gpx) : null;
	if (existing && path.dirname(existing) === path.resolve(p.gpx)) {
		writeAllAtomic([[existing, file]]);
		return;
	}
	const name = pickName(slug, date, isFirstPost(root, slug, date), (n) => existsSync(path.join(p.gpx, n)) && others.has(GPX_URL + n), '.gpx');
	writeAllAtomic([[path.join(p.gpx, name), file]]);
	await setPostKey(root, slug, date, 'gpx', GPX_URL + name);
}

/** The route GeoJSON file a post (or the hike) uses: front matter `filePath`, else geojson/<slug>.json. */
export function geojsonTarget(root: string, slug: string, front: any): { url: string; file: string } | null {
	const url = typeof front.filePath === 'string' ? front.filePath : defaultFilePath(slug);
	const file = served(root, url, GEOJSON_URL, repoPaths(root).geojson);
	return file ? { url, file } : null;
}

/** A doc's route line (`[lon, lat]` pairs) from its GeoJSON, a post's `filePath` respected; null without one. */
export function routeLine(root: string, slug: string, date: string | null): [number, number][] | null {
	assertSafeSlug(slug);
	if (date !== null) assertSafeDate(date);
	const t = geojsonTarget(root, slug, date ? postFront(root, slug, date) : {});
	return t && existsSync(t.file) ? geojsonLine(readFileSync(t.file, 'utf8')) : null;
}

export async function writeGeojson(root: string, slug: string, file: Buffer, date: string | null = null): Promise<void> {
	assertSafeSlug(slug);
	if (date !== null) assertSafeDate(date);
	if (!geojsonLine(file.toString('utf8'))) throw bad('Not a GeoJSON FeatureCollection with a LineString');
	const t = geojsonTarget(root, slug, date ? postFront(root, slug, date) : {});
	if (!t) throw bad('The post filePath is outside the geojson folder');
	writeAllAtomic([[t.file, file]]);
}

export function bailoutRoutes(sidecarRaw: string | null, postRaw: string | null): { route: string; at: string }[] {
	const out: { route: string; at: string }[] = [];
	const add = (list: unknown) => {
		if (!Array.isArray(list)) return;
		for (const b of list) if (b && typeof b.route === 'string' && !out.some((o) => o.route === b.route)) out.push({ route: b.route, at: typeof b.at === 'string' ? b.at : '' });
	};
	if (sidecarRaw) add((parse(sidecarRaw) as any)?.facts?.bailouts);
	if (postRaw) add((readFrontmatterDoc(postRaw).doc.toJS() as any)?.facts?.bailouts);
	return out;
}

/** Replaces the GPX of a bailout already listed in some `facts.bailouts[].route` (sidecars and posts). */
export async function replaceBailout(root: string, route: string, file: Buffer): Promise<void> {
	const dir = repoPaths(root).markdown;
	const known = existsSync(dir) && readdirSync(dir).some((f) => {
		if (!f.endsWith('.hike.json') && !f.endsWith('.md')) return false;
		const raw = readFileSync(path.join(dir, f), 'utf8');
		return f.endsWith('.md') ? bailoutRoutes(null, raw).some((b) => b.route === route) : bailoutRoutes(raw, null).some((b) => b.route === route);
	});
	if (!known) throw bad(`Unknown bailout route: ${route}`);
	const target = served(root, route, GPX_URL + 'bailouts/', repoPaths(root).bailouts);
	if (!target) throw bad(`Bailout route is outside the bailouts folder: ${route}`);
	validateGpx(file);
	writeAllAtomic([[target, file]]);
}

/**
 * Writes a new bailout GPX into the bailouts folder and answers its served path, for a bailout's `route`. The name
 * comes from the uploaded file's (lower case, ASCII with umlauts as `ae`/`oe`/`ue`, `_` for anything else), else the hike's slug; an existing file is
 * never overwritten: `-2`, `-3` are appended instead.
 */
export async function addBailout(root: string, slug: string, file: Buffer, filename: string): Promise<string> {
	assertSafeSlug(slug);
	validateGpx(file);
	const stem = path.basename(filename || '').replace(/\.gpx$/i, '')
		.normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
		.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
	const base = stem || slug;
	const dir = repoPaths(root).bailouts;
	let name = `${base}.gpx`;
	for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${base}-${n}.gpx`;
	writeAllAtomic([[path.join(dir, name), file]]);
	return `${GPX_URL}bailouts/${name}`;
}

// ---------------------------------------------------------------- state

export async function filesState(root: string, slug: string, date: string | null): Promise<FilesState> {
	assertSafeSlug(slug);
	const p = repoPaths(root);
	const sp = sidecarPath(root, slug);
	const sidecarRaw = existsSync(sp) ? readFileSync(sp, 'utf8') : null;
	const pp = date ? postPath(root, slug, date) : null;
	const postRaw = pp && existsSync(pp) ? readFileSync(pp, 'utf8') : null;
	const front = postRaw ? ((readFrontmatterDoc(postRaw).doc.toJS() ?? {}) as any) : {};
	const side = sidecarRaw ? (parse(sidecarRaw) as any) : {};

	let cover: FilesState['cover'] = null;
	const coverUrl = [front.image, side?.image].find((u) => typeof u === 'string' && served(root, u, IMAGE_URL, p.images));
	if (coverUrl) {
		const file = served(root, coverUrl, IMAGE_URL, p.images)!;
		if (existsSync(file)) {
			const m = await sharp(file).metadata().catch(() => null);
			if (m) {
				// ok = the thumbnail exists and is not older than the cover (a re-upload or a stale thumb needs a rebuild)
				const tp = path.join(p.thumbs, path.basename(file));
				const thumbOk = existsSync(tp) && statSync(tp).mtimeMs >= statSync(file).mtimeMs;
				cover = { path: coverUrl, w: m.autoOrient?.width ?? m.width!, h: m.autoOrient?.height ?? m.height!, bytes: statSync(file).size, thumbOk };
			}
		}
	}

	let gpx: FilesState['gpx'] = null;
	const g = resolveGpxUrl(root, slug, front);
	if (g) {
		const f = served(root, g.url, GPX_URL, p.gpx);
		if (f && existsSync(f)) gpx = { path: g.url, km: lengthKm(gpxPoints(readFileSync(f, 'utf8'))) };
	}

	let geojson: FilesState['geojson'] = null;
	const gt = geojsonTarget(root, slug, front);
	if (gt && existsSync(gt.file)) {
		const line = geojsonLine(readFileSync(gt.file, 'utf8'));
		if (line) geojson = { path: gt.url, km: lengthKm(line) };
	}

	const bailouts = bailoutRoutes(sidecarRaw, postRaw).map((b) => {
		const f = served(root, b.route, GPX_URL + 'bailouts/', p.bailouts);
		const km = f && existsSync(f) ? lengthKm(gpxPoints(readFileSync(f, 'utf8'))) : null;
		return { route: b.route, at: b.at, km };
	});
	return { cover, gpx, geojson, bailouts, firstPost: date === null || isFirstPost(root, slug, date) };
}

/**
 * The version of the files a doc's views read besides the doc itself: the route's GPX and GeoJSON, its bailout GPX
 * files, the OSM store and the facts library. Not the doc's `version` (a write to one of them, the CRM's own too, must
 * not make the doc's next save a conflict): the freshness check compares it apart, so an edit made outside the CRM shows.
 */
export function depsVersion(root: string, slug: string, date: string | null): string {
	assertSafeSlug(slug);
	const p = repoPaths(root);
	const sp = sidecarPath(root, slug);
	const sidecarRaw = existsSync(sp) ? readFileSync(sp, 'utf8') : null;
	const pp = date ? postPath(root, slug, date) : null;
	const postRaw = pp && existsSync(pp) ? readFileSync(pp, 'utf8') : null;
	const front = postRaw ? ((readFrontmatterDoc(postRaw).doc.toJS() ?? {}) as any) : {};
	const g = resolveGpxUrl(root, slug, front);
	const files = [
		g ? served(root, g.url, GPX_URL, p.gpx) : null,
		geojsonTarget(root, slug, front)?.file ?? null,
		...bailoutRoutes(sidecarRaw, postRaw).map((b) => served(root, b.route, GPX_URL + 'bailouts/', p.bailouts)),
		p.osmStore,
		p.factsLibrary
	];
	// Each file's path and text (a missing one as such), so a file appearing, going or moving counts too.
	return versionOf(files.map((f) => `${f ?? ''}\0${f && existsSync(f) ? readFileSync(f, 'utf8') : '\u0001'}`).join('\0'));
}

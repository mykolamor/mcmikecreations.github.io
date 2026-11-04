import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encodeTiersTo, imageBlur } from '../lib/images';
import { avifTiers, avifVariantHref } from '../../../src/lib/renderers/responsive-image';

// Port of the former scripts/matches/video_meta.py: date, duration, en/de/uk texts and a self-hosted poster, read without an API key.
const WATCH_URL = (id: string) => `https://www.youtube.com/watch?v=${id}`;
// What the watch page calls for its title block; unlike the page, it honours `hl`.
const NEXT_URL = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
const NEXT_CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00' };
const LANGS = ['en', 'de', 'uk'] as const;
// Best first. maxresdefault is 404 for videos without an HD thumbnail.
const THUMBS = ['maxresdefault', 'sddefault', 'hqdefault'];
// English page, and past the EU cookie consent wall.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'Accept-Language': 'en', Cookie: 'SOCS=CAI' };
const TIMEOUT_MS = 30_000;
const DESCRIPTION_MAX = 500;
// Rows darker than this (mean luminance) count as letterbox bars.
const BAR_LUMA = 16;
// A smaller thumbnail is YouTube's grey placeholder.
const MIN_THUMB_BYTES = 2000;
const POSTERS = 'static/images/projects/data-viz/hikes/videos';
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CYRILLIC_RE = /[Ѐ-ӿ]/;
const REQUIRED = ['uploadDate', 'duration', 'w', 'h', 'blur'];
const FIELD_ORDER = ['uploadDate', 'duration', 'title', 'description', 'w', 'h'];

export type VideoFetcher = {
	page(id: string): Promise<string>;
	localized(id: string, lang: string): Promise<string>;
	thumbnail(id: string): Promise<Buffer | null>;
};

/** The video id in a watch, youtu.be, shorts, embed or live URL. */
export function youtubeId(url: string): string | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	const host = u.hostname.toLowerCase();
	let id = '';
	if (host.endsWith('youtu.be')) id = u.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
	else if (host.endsWith('youtube.com')) {
		if (u.pathname === '/watch') id = u.searchParams.get('v') ?? '';
		else {
			const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
			id = parts.length > 1 && ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : '';
		}
	} else return null;
	return ID_RE.test(id) ? id : null;
}

const unescapeHtml = (s: string) =>
	s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
		if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
		return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]!;
	});

function meta(page: string, name: string): string | null {
	const m = page.match(new RegExp(`<meta itemprop="${name}" content="([^"]*)"`));
	return m ? unescapeHtml(m[1]) : null;
}

export function firstParagraph(text: string, limit = DESCRIPTION_MAX): string {
	let para = text.trim().split('\n\n')[0].trim().replace(/\s*\n\s*/g, ' ');
	if (para.length > limit) {
		const cut = para.slice(0, limit);
		const sp = cut.lastIndexOf(' ');
		para = (sp === -1 ? cut : cut.slice(0, sp)).replace(/[,.;:]+$/, '') + '…';
	}
	return para;
}

/** `{uploadDate, duration}` from a watch page, or null when the video isn't playable (private, removed, age-gated). */
export function parseWatchPage(page: string): { uploadDate: string; duration: string } | null {
	const status = page.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/);
	if (!status || status[1] !== 'OK') return null;
	const uploadDate = meta(page, 'uploadDate');
	const duration = meta(page, 'duration');
	return uploadDate && duration ? { uploadDate, duration } : null;
}

/** Title and the description's first paragraph from a `next` response. */
export function parseNext(payload: string): { title?: string; description?: string } {
	const title = payload.match(/"videoPrimaryInfoRenderer":\{"title":\{"runs":\[\{"text":("(?:[^"\\]|\\.)*")/);
	const description = payload.match(/"attributedDescription":\{"content":("(?:[^"\\]|\\.)*")/);
	const out: { title?: string; description?: string } = {};
	if (title) out.title = JSON.parse(title[1]);
	const d = description ? firstParagraph(JSON.parse(description[1])) : '';
	if (d) out.description = d;
	return out;
}

/** Without a translation YouTube sends the original, so a Ukrainian original asked for in English comes back in Cyrillic. */
export function inLanguage(text: string, lang: string): boolean {
	return CYRILLIC_RE.test(text) === (lang === 'uk');
}

/** Per field, the texts per language YouTube really has; a language equal to the English one (no translation) is left out. */
export async function localizedTexts(fetcher: VideoFetcher, id: string): Promise<Record<string, Record<string, string>>> {
	const out: Record<'title' | 'description', Record<string, string>> = { title: {}, description: {} };
	for (const lang of LANGS) {
		const parsed = parseNext(await fetcher.localized(id, lang));
		for (const key of ['title', 'description'] as const) {
			const text = parsed[key];
			if (!text || !inLanguage(text, lang)) continue;
			if (lang !== 'en' && text === out[key].en) continue;
			out[key][lang] = text;
		}
	}
	return Object.fromEntries(Object.entries(out).filter(([, v]) => Object.keys(v).length));
}

export type TrimInfo = { width: number; height: number; trimmed: boolean; top: number };

/** Crops black bars off the top and bottom (sd/hq thumbnails of a 16:9 video are 4:3 with bars). Untrimmed: the input buffer itself. */
export async function trimLetterbox(img: Buffer): Promise<{ data: Buffer; info: TrimInfo }> {
	const { data: px, info } = await sharp(img).rotate().removeAlpha().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
	const { width: w, height: h, channels: c } = info;
	const dark = (y: number) => {
		let sum = 0;
		for (let x = 0; x < w; x++) sum += px[(y * w + x) * c];
		return sum / w < BAR_LUMA;
	};
	const third = Math.floor(h / 3);
	let top = 0;
	let bottom = h;
	while (top < third && dark(top)) top++;
	while (bottom > h - third && dark(bottom - 1)) bottom--;
	if (top === 0 && bottom === h) return { data: img, info: { width: w, height: h, trimmed: false, top: 0 } };
	const data = await sharp(img).rotate().extract({ left: 0, top, width: w, height: bottom - top }).jpeg({ quality: 90 }).toBuffer();
	return { data, info: { width: w, height: bottom - top, trimmed: true, top } };
}

async function http(url: string, init: RequestInit = {}): Promise<Response> {
	const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	return res;
}

export function createFetcher(): VideoFetcher {
	return {
		async page(id) {
			const r = await http(WATCH_URL(id));
			if (!r.ok) throw new Error(`watch page ${id}: HTTP ${r.status}`);
			return r.text();
		},
		async localized(id, lang) {
			const body = { context: { client: { ...NEXT_CLIENT, hl: lang } }, videoId: id };
			const r = await http(NEXT_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
			if (!r.ok) throw new Error(`next ${id} ${lang}: HTTP ${r.status}`);
			return r.text();
		},
		async thumbnail(id) {
			for (const name of THUMBS) {
				const r = await http(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
				if (!r.ok) continue;
				const buf = Buffer.from(await r.arrayBuffer());
				if (buf.length > MIN_THUMB_BYTES) return buf;
			}
			return null;
		}
	};
}

/** Serves fixtures/youtube/: one public video (B5yRsnelCsw) and one private (PrivateVid1). */
export function createStubFetcher(): VideoFetcher {
	const dir = fileURLToPath(new URL('./fixtures/youtube', import.meta.url));
	return {
		page: async (id) => readFile(path.join(dir, id === 'PrivateVid1' ? 'watch-private.html' : 'watch-B5yRsnelCsw.html'), 'utf8'),
		localized: async (_id, lang) => readFile(path.join(dir, `next-${lang}.json`), 'utf8'),
		thumbnail: async () => readFile(path.join(dir, 'hqdefault.jpg'))
	};
}

/** The fetcher the API uses; CRM_YOUTUBE_STUB=1 serves the fixtures instead of the network. */
export function videoFetcher(): VideoFetcher {
	return process.env.CRM_YOUTUBE_STUB === '1' ? createStubFetcher() : createFetcher();
}

/** Writes the poster and its AVIF tiers from a downloaded thumbnail; the tiers come from the trimmed pixels, not the q90 JPEG. */
async function writePoster(root: string, id: string, thumb: Buffer): Promise<{ w: number; h: number; blur: string }> {
	const href = `/images/projects/data-viz/hikes/videos/${id}.jpg`;
	const file = path.join(root, POSTERS, `${id}.jpg`);
	const { data, info } = await trimLetterbox(thumb);
	const pixels = info.trimmed ? await sharp(thumb).rotate().extract({ left: 0, top: info.top, width: info.width, height: info.height }).png().toBuffer() : thumb;
	await mkdir(path.dirname(file), { recursive: true });
	// Untrimmed, YouTube's own JPEG is smaller than a re-encode.
	await writeFile(file, data);
	const { w, h, blur } = await encodeTiersTo(pixels, href, root);
	return { w, h, blur };
}

/** `{w, h, blur}` of a poster already on disk; tiers are only encoded when some are missing, so committed ones stay byte-identical. */
async function readPoster(root: string, id: string): Promise<{ w: number; h: number; blur: string }> {
	const file = path.join(root, POSTERS, `${id}.jpg`);
	const meta = await imageBlur(file);
	let missing = false;
	for (const { target } of avifTiers(meta.w, meta.h)) if (!(await exists(avifVariantHref(file, target)))) missing = true;
	if (missing) await encodeTiersTo(file, `/images/projects/data-viz/hikes/videos/${id}.jpg`, root, { skipExisting: true });
	return meta;
}

/** All REQUIRED fields and an English title (a plain-string title is the old single-language format). */
export function complete(entry: Record<string, unknown> | null | undefined): boolean {
	if (!entry || REQUIRED.some((k) => entry[k] == null)) return false;
	const title = entry.title;
	return !!title && typeof title === 'object' && 'en' in title;
}

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file);
		return true;
	} catch {
		return false;
	}
}

/**
 * The new front-matter entry for `id` (key order uploadDate, duration, title, description, w, h, blur), `{unavailable: true}` for a
 * video that isn't public, or null on network trouble (nothing is written then). Per language, hand edits win unless `refresh`.
 */
export async function videoEntry(root: string, id: string, old: Record<string, unknown> | null, fetcher: VideoFetcher, opts: { refresh: boolean }): Promise<Record<string, unknown> | null> {
	let info: ReturnType<typeof parseWatchPage>;
	let texts: Record<string, Record<string, string>>;
	let thumb: Buffer | null = null;
	const have = !opts.refresh && (await exists(path.join(root, POSTERS, `${id}.jpg`)));
	// Only network trouble returns null; encode and disk errors below throw.
	try {
		info = parseWatchPage(await fetcher.page(id));
		if (!info) {
			console.warn(`${id} isn't public (private or removed)`);
			return { unavailable: true };
		}
		texts = await localizedTexts(fetcher, id);
		if (!have) thumb = await fetcher.thumbnail(id);
	} catch (e) {
		console.warn(`could not fetch ${id}: ${e instanceof Error ? e.message : e}`);
		return null;
	}
	const poster = have ? await readPoster(root, id) : thumb ? await writePoster(root, id, thumb) : null;
	if (!poster) console.warn(`${id} has no thumbnail`);
	if (!texts.title?.en) console.warn(`${id} has no English title`);
	const base: Record<string, unknown> = opts.refresh ? {} : { ...(old ?? {}) };
	delete base.unavailable;
	Object.assign(base, info);
	for (const [key, byLang] of Object.entries(texts)) {
		const prev = base[key];
		base[key] = { ...byLang, ...(prev && typeof prev === 'object' ? (prev as Record<string, string>) : {}) };
	}
	if (poster) Object.assign(base, { w: poster.w, h: poster.h });
	const blur = poster ? poster.blur : base.blur;
	delete base.blur;
	const entry: Record<string, unknown> = {};
	for (const k of FIELD_ORDER) if (base[k] !== undefined) entry[k] = base[k];
	for (const [k, v] of Object.entries(base)) if (!(k in entry)) entry[k] = v;
	if (blur !== undefined) entry.blur = blur; // the long data URI stays last
	return entry;
}

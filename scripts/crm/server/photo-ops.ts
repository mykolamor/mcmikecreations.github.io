// Photo operations on a post's or place doc's `images:` front matter and AVIF tier files: add from Immich, upload or
// the library, and remove. Every write runs under the doc's lock with the base-version check; adding or removing stamps
// `updated:` on published posts (updated-rule.ts), never on place docs.
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Pair, Scalar, isMap, isScalar, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import exifr from 'exifr';
import { localMediaHrefs } from '../../../src/lib/hikes/translations.server';
import { AVIF_TIERS, avifVariantHref } from '../../../src/lib/renderers/responsive-image';
import { flowEntry, readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { encodeImage, encodeTiersTo, type EncodedImage } from '../lib/images';
import { PLACES, STORIES, keyFor, ownFolderOf } from '../lib/image-key';
import { clientDoc, loadDoc } from './doc';
import { withDocLock } from './doc-lock';
import { assertPlaceSlug, docFile, linksKey, lockKey, ownFolder, type DocRef } from './doc-ref';
import { loadPlace, placeClientDoc } from './place-doc';
import { ApiError } from './errors';
import { served, writeAllAtomic } from './files';
import { linkOf, readLinks, setLink } from './immich-links';
import { positionAt, recordedTrack } from './photo-badges';
import { ImmichUnreachableError, type Immich } from './immich-client';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { translationBodies } from './translations';
import { createTerrain, type Terrain } from './terrain';
import { localToday, maybeStampUpdated, type StampOptions } from './updated-rule';
import { readStore, type Store } from '../lib/osm-store-file';

export const USED_IN_TEXT = 'used in the text — remove it in Write first';
const TOPO = '/images/hikes/topo/';

/** 409 for a stale `base`: carries the current doc so the client can rebase (a place doc has no mirrors). */
export class StaleDocError extends ApiError {
	version: string;
	fields: Record<string, unknown>;
	mirrors: unknown[];
	body: string | null;
	constructor(d: { version: string; fields: Record<string, unknown>; mirrors?: unknown[]; body: string | null }) {
		super(409, 'changed on disk');
		this.version = d.version;
		this.fields = d.fields;
		this.mirrors = d.mirrors ?? [];
		this.body = d.body;
	}
}

export type PhotoDeps = StampOptions & { terrain?: Terrain };
export type PhotoResult = { key: string; href: string; version: string; stamped: boolean; previous?: string | null };
/** `linkError`: the photo was added but its Immich link could not be saved (non-blocking; "Find in Immich" can link it later). */
export type AddResult = PhotoResult & { linkError?: string };

/** A doc that holds photos: a dated post or a place doc (a hike's sidecar has no `images`). */
export type PhotoRef = Extract<DocRef, { kind: 'post' | 'place' }>;
/** `links`: the doc's immich-links.json key; `own`: its media folder; `pp`: its markdown file. */
export type Ctx = { root: string; ref: PhotoRef; links: string; own: string; pp: string };

export function ctxOf(root: string, ref: DocRef): Ctx {
	if (ref?.kind === 'place') assertPlaceSlug(ref.slug);
	else if (ref?.kind === 'post') {
		assertSafeSlug(ref.slug);
		assertSafeDate(ref.date);
	} else throw new ApiError(400, 'Photos belong to a post (a dated visit) or a place doc');
	return { root, ref, links: linksKey(ref), own: ownFolder(ref), pp: docFile(root, ref)! };
}

export const versionOf = (c: Ctx): string => (c.ref.kind === 'place' ? loadPlace(c.root, c.ref.slug).version : loadDoc(c.root, c.ref.slug, c.ref.date).version);
const isPlace = (c: Ctx): boolean => c.ref.kind === 'place';
const docName = (c: Ctx): string => (isPlace(c) ? 'this place doc' : 'this post');

const hrefOf = (key: string, own: string): string => (key.startsWith('/') ? key : own + key);
export const imagesAbs = (root: string, href: string): string | null => served(root, href, '/images/', path.join(repoPaths(root).static, 'images'));

/** Runs `fn` under the doc's lock once `base` is the doc's current version (else StaleDocError). `first` may answer before the check. */
export function guarded<T>(c: Ctx, base: string, fn: () => Promise<T>, first?: () => T | undefined): Promise<T> {
	return withDocLock(lockKey(c.ref), async () => {
		const early = first?.();
		if (early !== undefined) return early;
		if (c.ref.kind === 'place') {
			const cur = loadPlace(c.root, c.ref.slug);
			if (cur.version !== base) throw new StaleDocError(placeClientDoc(cur));
		} else {
			const cur = loadDoc(c.root, c.ref.slug, c.ref.date);
			if (cur.version !== base) throw new StaleDocError(clientDoc(cur));
		}
		return fn();
	});
}

export function readPost(c: Ctx): { raw: string; doc: Document; body: string } {
	const raw = readFileSync(c.pp, 'utf8');
	return { raw, ...readFrontmatterDoc(raw) };
}

function imagesMap(doc: Document): YAMLMap | null {
	const m = doc.get('images', true);
	return isMap(m) ? m : null;
}

function hasEntry(c: Ctx, key: string): boolean {
	return !!imagesMap(readPost(c).doc)?.has(key);
}

/** `lines` after the body, which first gets a trailing newline when it has none (so a blank line separates them). */
const appendLines = (body: string, lines: string): string => (body === '' || body.endsWith('\n') ? body : body + '\n') + lines;

/** Adds `images.<key>` (appended) and, with `append`, lines at the end of the body; writes the post atomically. */
function writeEntry(c: Ctx, key: string, values: Record<string, string | number | undefined>, append?: string): void {
	const { doc, body } = readPost(c);
	let map = imagesMap(doc);
	if (!map) {
		doc.set('images', doc.createNode({}));
		map = doc.get('images', true) as YAMLMap;
	}
	const entry = flowEntry(doc, values);
	// ruamel wrote demEle as a float: 1086.0, not 1086
	const ele = entry.get('demEle', true);
	if (isScalar(ele)) ele.minFractionDigits = 1;
	// `located: track` is written plain, as in existing entries
	const loc = entry.get('located', true);
	if (isScalar(loc)) loc.type = Scalar.PLAIN;
	map.set(key, entry);
	writeAllAtomic([[c.pp, writeFrontmatterDoc(doc, append === undefined ? body : appendLines(body, append))]]);
}

function removeTiers(abs: string): void {
	for (const t of AVIF_TIERS) {
		try {
			unlinkSync(avifVariantHref(abs, t));
		} catch {
			/* tier not present */
		}
	}
}

/** The result of an add or remove; a published post gets `updated:` stamped, a place doc never does. */
export async function finish(c: Ctx, key: string, deps: PhotoDeps): Promise<PhotoResult> {
	const s = isPlace(c) ? { stamped: false as const } : await maybeStampUpdated(c.root, c.pp, deps);
	return { key, href: hrefOf(key, c.own), version: versionOf(c), ...s };
}

const current = (c: Ctx, key: string): PhotoResult => ({ key, href: hrefOf(key, c.own), version: versionOf(c), stamped: false });

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The post body references the image: the full href, or (bare key) any link target ending in `/<key>`. */
function bodyUses(body: string, key: string, href: string): boolean {
	if (body.includes(href)) return true;
	return !key.startsWith('/') && new RegExp(`\\]\\(\\s*<?[^)\\s>]*/${esc(key)}(?=[>)\\s"])`).test(body);
}

/** A translation of the doc (next to it, `<name>.<lang>.md`) shows the image: translations link photos by full href. */
function translationUses(c: Ctx, href: string): boolean {
	const decoded = (h: string) => {
		try {
			return decodeURI(h);
		} catch {
			return h;
		}
	};
	return translationBodies(c.pp).some((body) => localMediaHrefs(body).some((h) => decoded(h) === href));
}

/** Fields copied from another doc's entry when reusing its image, in writer order (pins stay with that doc). */
const ENTRY_FIELDS = ['w', 'h', 'lat', 'lon', 'demEle', 'taken', 'located', 'blur'] as const;

/**
 * Scans every post and place doc for `href`: `used` when an `images` key resolves to it or a body mentions it
 * (unreadable front matter counts when the raw text mentions the file); `entry` = the first `images` entry for it.
 */
function scanDocs(root: string, href: string): { used: boolean; entry?: Record<string, unknown> } {
	const p = repoPaths(root);
	let used = false;
	for (const dir of [p.markdown, p.places]) {
		if (!existsSync(dir)) continue;
		for (const f of readdirSync(dir).sort()) {
			if (!f.endsWith('.md')) continue;
			const raw = readFileSync(path.join(dir, f), 'utf8');
			let parsed: { doc: Document; body: string };
			try {
				parsed = readFrontmatterDoc(raw);
			} catch {
				if (raw.includes(path.posix.basename(href))) used = true;
				continue;
			}
			if (parsed.body.includes(href)) used = true;
			const own = ownFolderOf(f);
			const it = imagesMap(parsed.doc)?.items.find((i) => isScalar(i.key) && hrefOf(String(i.key.value), own) === href);
			if (it) {
				const v = isMap(it.value) ? (it.value.toJS(parsed.doc) as Record<string, unknown>) : null;
				if (v && typeof v.w === 'number' && typeof v.h === 'number') return { used: true, entry: v };
				used = true;
			}
		}
	}
	return { used };
}

const hrefInUse = (root: string, href: string): boolean => scanDocs(root, href).used;

/**
 * Next `<date>-NN<ext>` after the highest NN of that date in the doc's keys, body links and own folder's files (photos
 * and videos share the numbering). A post numbers under its own date; a place doc under the photo's local `taken`
 * date, else today (`keyDate`).
 */
export function nextKey(c: Ctx, date: string, ext = '.jpg'): string {
	const { doc, body } = readPost(c);
	const nums: number[] = [];
	const re = new RegExp(`^${esc(date)}-(\\d{2,3})(?:-(?:${AVIF_TIERS.join('|')}))?\\.[A-Za-z0-9]+$`);
	const names: string[] = [];
	for (const it of imagesMap(doc)?.items ?? []) {
		if (!isScalar(it.key)) continue;
		const k = String(it.key.value);
		if (!k.startsWith('/')) names.push(k);
		else if (k.startsWith(c.own)) names.push(k.slice(c.own.length));
	}
	for (const m of body.matchAll(new RegExp(`${esc(c.own)}([^)\\s"/>]+)`, 'g'))) names.push(m[1]);
	const dir = imagesAbs(c.root, c.own);
	if (dir && existsSync(dir)) names.push(...readdirSync(dir));
	for (const n of names) {
		const m = re.exec(n);
		if (m) nums.push(Number(m[1]));
	}
	const next = nums.length ? Math.max(...nums) + 1 : 0;
	return `${date}-${String(next).padStart(2, '0')}${ext}`;
}

/** The date a new media key of the doc is numbered under: the post's date; for a place doc the local date of `taken`, else today. */
export function keyDate(c: Ctx, taken: string | undefined, deps: StampOptions): string {
	if (c.ref.kind === 'post') return c.ref.date;
	const d = /^\d{4}-\d{2}-\d{2}/.exec(taken ?? '')?.[0];
	return d && !Number.isNaN(Date.parse(d)) ? d : (deps.today ?? (() => localToday()))();
}

async function encodeOrBad(source: Buffer, href: string, root: string): Promise<EncodedImage> {
	let enc: EncodedImage;
	try {
		enc = await encodeTiersTo(source, href, root);
	} catch (e) {
		if (e instanceof ApiError) throw e;
		throw new ApiError(400, `Could not read the image: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!enc.tiers.length) throw new ApiError(400, 'Image too small: the long edge must be at least 640 px');
	return enc;
}

/** Writes the entry (and `append`); on failure removes the just-written tiers so nothing is half-added. */
function commitEntry(c: Ctx, key: string, href: string, values: Record<string, string | number | undefined>, append?: string): void {
	try {
		writeEntry(c, key, values, append);
	} catch (e) {
		const abs = imagesAbs(c.root, href);
		if (abs) removeTiers(abs);
		throw e;
	}
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Adds an Immich asset as `<date>-NN.jpg` in the doc's own folder (a post's stories folder, a place doc's places
 * folder): tiers only (no original), entry `w, h, lat, lon, demEle, taken, blur`, and the asset link. An asset already
 * linked in this doc answers its key.
 */
export async function addFromImmich(root: string, ref: DocRef, assetId: string, base: string, deps: PhotoDeps & { immich: Immich }): Promise<AddResult> {
	const c = ctxOf(root, ref);
	if (typeof assetId !== 'string' || !assetId) throw new ApiError(400, 'assetId is required');
	const linked = (): PhotoResult | undefined => {
		const key = Object.entries(readLinks(root)[c.links] ?? {}).find(([, id]) => id === assetId)?.[0];
		return key !== undefined && hasEntry(c, key) ? current(c, key) : undefined;
	};
	const early = await withDocLock(lockKey(c.ref), linked);
	if (early) return early;
	// Downloaded outside the lock (seconds for a large original); the lock is only held while files are written.
	const [orig, asset] = await Promise.all([deps.immich.original(assetId), deps.immich.asset(assetId)]);
	return guarded(
		c,
		base,
		async () => {
			const key = nextKey(c, keyDate(c, asset.takenLocal, deps));
			const href = hrefOf(key, c.own);
			const enc = await encodeOrBad(orig.bytes, href, root);
			const hasPos = typeof asset.lat === 'number' && typeof asset.lon === 'number';
			const lat = hasPos ? round6(asset.lat!) : undefined;
			const lon = hasPos ? round6(asset.lon!) : undefined;
			const demEle = hasPos ? ((deps.terrain ?? createTerrain(repoPaths(root).demDir)).height(asset.lat!, asset.lon!) ?? undefined) : undefined;
			commitEntry(c, key, href, { w: enc.w, h: enc.h, lat, lon, demEle, taken: asset.takenLocal || undefined, blur: enc.blur });
			// The entry and tiers are written: a failed link must not turn that into an error the client would retry.
			let linkError: string | undefined;
			try {
				await setLink(root, c.links, key, assetId);
			} catch (e) {
				linkError = e instanceof Error ? e.message : String(e);
			}
			const r = await finish(c, key, deps);
			return linkError === undefined ? r : { ...r, linkError };
		},
		linked
	);
}

/** EXIF `taken` (wall clock + OffsetTimeOriginal; omitted without an offset) and GPS position (6 dp) of an upload. */
export async function exifOf(file: Buffer): Promise<{ taken?: string; lat?: number; lon?: number }> {
	let ex: any;
	try {
		ex = await exifr.parse(file, { reviveValues: false });
	} catch {
		return {};
	}
	if (!ex) return {};
	const out: { taken?: string; lat?: number; lon?: number } = {};
	const dt = typeof ex.DateTimeOriginal === 'string' ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(ex.DateTimeOriginal) : null;
	const off = typeof ex.OffsetTimeOriginal === 'string' ? /^([+-]\d{2}:\d{2}|Z)$/.exec(ex.OffsetTimeOriginal.trim()) : null;
	if (dt && off) out.taken = `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4]}:${dt[5]}:${dt[6]}${off[1] === 'Z' ? '+00:00' : off[1]}`;
	const lat = ex.latitude, lon = ex.longitude;
	if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
		out.lat = round6(lat);
		out.lon = round6(lon);
	}
	return out;
}

export type UploadOptions = { target: 'stories' | 'topo' | string; credit?: string; sourceUrl?: string };

/** `/images/…/` folder for an upload target, or 400. */
function targetFolder(c: Ctx, target: string): string {
	if (!target || target === 'stories') return c.own;
	if (target === 'topo') return TOPO;
	const norm = path.posix.normalize('/' + String(target).replace(/^\/+|\/+$/g, '') + '/');
	if (!norm.startsWith('/images/') || norm.split('/').includes('..')) throw new ApiError(400, `Upload target must be a folder under static/images: ${target}`);
	return norm;
}

function safeStem(filename: string): string {
	const stem = path.basename(String(filename ?? '')).replace(/\.[^.]*$/, '');
	const s = stem
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return s || 'image';
}

/** Caption credit text: `by [credit](url)`, `by credit`, or `Credit: [host](url)`. */
export function creditCaption(credit?: string, sourceUrl?: string): string | undefined {
	const name = credit?.trim();
	const url = sourceUrl?.trim();
	if (url && !/^https?:\/\/[^\s)]+$/.test(url)) throw new ApiError(400, 'Source URL must be an http(s) link');
	if (name && url) return `by [${name}](${url})`;
	if (name) return `by ${name}`;
	if (url) return `Credit: [${new URL(url).hostname.replace(/^www\./, '')}](${url})`;
	return undefined;
}

/**
 * Uploads an image (JPEG/PNG/WebP/HEIC…) as AVIF tiers only. Stories target (the doc's own folder): next
 * `<date>-NN.jpg`, bare key; any other folder: the sanitised file name (suffixed `-2`, `-3`… when taken), full-href key.
 * With a credit or source URL, the credit line and an image line go to the end of the body in the same write, so the
 * credit is in the text for sure; the author moves them into place in Write.
 */
export async function addUpload(root: string, ref: DocRef, file: Buffer, filename: string, opts: UploadOptions, base: string, deps: PhotoDeps = {}): Promise<PhotoResult & { caption?: string }> {
	const c = ctxOf(root, ref);
	if (!file?.length) throw new ApiError(400, 'Empty upload');
	const folder = targetFolder(c, opts?.target ?? 'stories');
	if (!imagesAbs(root, folder + 'x')) throw new ApiError(400, `Upload target must be a folder under static/images: ${opts.target}`);
	const caption = creditCaption(opts?.credit, opts?.sourceUrl);
	// A photo of the hike or place keeps its EXIF time and position; topos and other shared images don't need them.
	const ex: Awaited<ReturnType<typeof exifOf>> = folder === c.own ? await exifOf(file) : {};
	return guarded(c, base, async () => {
		let href: string;
		if (folder === c.own) href = c.own + nextKey(c, keyDate(c, ex.taken, deps));
		else {
			const ext = /\.png$/i.test(filename) ? '.png' : /\.webp$/i.test(filename) ? '.webp' : '.jpg';
			const stem = safeStem(filename);
			const taken = (h: string) => {
				const abs = imagesAbs(root, h)!;
				return existsSync(abs) || AVIF_TIERS.some((t) => existsSync(avifVariantHref(abs, t))) || hrefInUse(root, h);
			};
			let n = 1;
			href = folder + stem + ext;
			while (taken(href)) href = `${folder}${stem}-${++n}${ext}`;
		}
		const key = keyFor(href, c.own);
		const enc = await encodeOrBad(file, href, root);
		const demEle = ex.lat !== undefined && ex.lon !== undefined ? ((deps.terrain ?? createTerrain(repoPaths(root).demDir)).height(ex.lat, ex.lon) ?? undefined) : undefined;
		const lines = caption === undefined ? undefined : `\n${caption}\n![](${href})\n`;
		commitEntry(c, key, href, { w: enc.w, h: enc.h, lat: ex.lat, lon: ex.lon, demEle, taken: ex.taken, blur: enc.blur }, lines);
		const r = await finish(c, key, deps);
		return caption === undefined ? r : { ...r, caption };
	});
}

/**
 * Reuses an existing `static/images/…` image (full-href key outside the stories folder). With its original: makes
 * missing tiers/blur next to it. Tier-only (a story photo whose original was dropped): copies the entry another post
 * or place doc has for it (w, h, lat, lon, demEle, taken, located, blur; no pins) — 422 when none describes it,
 * 404 when there are no tiers either.
 */
export async function addFromLibrary(root: string, ref: DocRef, href: string, base: string, deps: PhotoDeps = {}): Promise<PhotoResult> {
	const c = ctxOf(root, ref);
	const abs = typeof href === 'string' && /\.(jpe?g|png|webp)$/i.test(href) ? imagesAbs(root, href) : null;
	if (!abs) throw new ApiError(400, `Not an image under static/images: ${href}`);
	const hasOriginal = existsSync(abs);
	if (!hasOriginal && !existsSync(avifVariantHref(abs, AVIF_TIERS[0]))) throw new ApiError(404, `No such image: ${href}`);
	const key = keyFor(href, c.own);
	const present = () => (hasEntry(c, key) ? current(c, key) : undefined);
	return guarded(
		c,
		base,
		async () => {
			if (!hasOriginal) {
				const found = scanDocs(root, href).entry;
				if (!found) throw new ApiError(422, `No post or place describes ${href} (size, blur); add it from Immich or upload it instead`);
				const values: Record<string, string | number | undefined> = {};
				for (const k of ENTRY_FIELDS) if (typeof found[k] === 'string' || typeof found[k] === 'number') values[k] = found[k] as string | number;
				writeEntry(c, key, values);
				return finish(c, key, deps);
			}
			let enc: EncodedImage;
			try {
				enc = await encodeImage(abs);
			} catch (e) {
				throw new ApiError(400, `Could not read the image: ${e instanceof Error ? e.message : String(e)}`);
			}
			// The original stays (it is a library file), so an image below 640 px is valid without tiers or blur.
			writeEntry(c, key, { w: enc.w, h: enc.h, blur: enc.tiers.length ? enc.blur : undefined });
			return finish(c, key, deps);
		},
		present
	);
}

/**
 * Removes `images.<key>` and its asset link; refuses (409) while the doc's text still shows it. The tier files go
 * only for a photo in the stories or places tree (the doc folders the CRM fills) that no post or place doc references
 * any more; tiers of other `/images/…` library files (topos, shared images) and originals are never deleted.
 */
export async function removePhoto(root: string, ref: DocRef, key: string, base: string, deps: PhotoDeps = {}): Promise<Omit<PhotoResult, 'href'> & { href: string; tiersRemoved: boolean }> {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	return guarded(c, base, async () => {
		const { doc, body } = readPost(c);
		const map = imagesMap(doc);
		if (!map?.has(key)) throw new ApiError(404, `No image ${key} in ${docName(c)}`);
		const href = hrefOf(key, c.own);
		if (bodyUses(body, key, href) || translationUses(c, href)) throw new ApiError(409, USED_IN_TEXT);
		map.delete(key);
		if (!map.items.length) doc.delete('images');
		writeAllAtomic([[c.pp, writeFrontmatterDoc(doc, body)]]);
		if (readLinks(root)[c.links]?.[key] !== undefined) await setLink(root, c.links, key, null);
		const abs = imagesAbs(root, href);
		const tiersRemoved = !!abs && (href.startsWith(STORIES) || href.startsWith(PLACES)) && !hrefInUse(root, href);
		if (tiersRemoved) removeTiers(abs!);
		return { ...(await finish(c, key, deps)), tiersRemoved };
	});
}

export type PostPhoto = {
	key: string;
	href: string;
	/** The linked Immich asset, null when unlinked. */
	assetId: string | null;
	/** The post's text shows it (removing is refused while true). */
	inText: boolean;
	pins: number;
	w?: number;
	h?: number;
	lat?: number;
	lon?: number;
	taken?: string;
	located?: string;
	alt?: string;
};

/** The doc's `images` entries in front-matter order, for the Photos tab's "In this post" list. 404 when there is no such doc. */
export function postPhotos(root: string, ref: DocRef): PostPhoto[] {
	const c = ctxOf(root, ref);
	let post: ReturnType<typeof readPost>;
	try {
		post = readPost(c);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, `No such ${isPlace(c) ? 'place doc' : 'post'}: ${c.links}`);
		throw e;
	}
	const images = (imagesMap(post.doc)?.toJSON() ?? {}) as Record<string, Record<string, unknown> | null>;
	const links = readLinks(root)[c.links] ?? {};
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
	const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
	return Object.entries(images).map(([key, raw]) => {
		const im = raw && typeof raw === 'object' ? raw : {};
		const href = hrefOf(key, c.own);
		const out: PostPhoto = { key, href, assetId: typeof links[key] === 'string' ? links[key] : null, inText: bodyUses(post.body, key, href) || translationUses(c, href), pins: Array.isArray(im.pins) ? im.pins.length : 0 };
		for (const k of ['w', 'h', 'lat', 'lon'] as const) if (num(im[k]) !== undefined) out[k] = num(im[k]);
		for (const k of ['taken', 'located', 'alt'] as const) if (str(im[k]) !== undefined) out[k] = str(im[k]);
		return out;
	});
}

// ---------------------------------------------------------------- fixes: time, location, alt

export const FIELD_ORDER = ['w', 'h', 'lat', 'lon', 'demEle', 'taken', 'located', 'blur', 'pins', 'alt'];
export type ImmichError = { key: string; message: string };
type FixDeps = PhotoDeps & { immich?: Immich };

const fieldRank = (k: unknown): number => {
	const i = FIELD_ORDER.indexOf(String((k as Scalar)?.value ?? k));
	return i < 0 ? FIELD_ORDER.length : i;
};

/**
 * Edits existing `images.<key>` entries in place, then writes the doc atomically. The fields are put back in
 * FIELD_ORDER, unless `reorder` is false: then only new keys take their FIELD_ORDER place and the others stay put.
 */
export function editEntry(c: Ctx, keys: string[], edit: (key: string, entry: YAMLMap, doc: Document) => void, reorder = true): void {
	const { doc, body } = readPost(c);
	const map = imagesMap(doc);
	for (const key of keys) {
		const entry = map?.get(key, true);
		if (!isMap(entry)) throw new ApiError(404, `No image ${key} in ${docName(c)}`);
		edit(key, entry, doc);
		if (reorder) entry.items = entry.items.map((it, n) => ({ it, n })).sort((a, b) => fieldRank(a.it.key) - fieldRank(b.it.key) || a.n - b.n).map((x) => x.it);
	}
	writeAllAtomic([[c.pp, writeFrontmatterDoc(doc, body)]]);
}

/**
 * Where a missing key `k` goes in an entry: right after the last key ranked before it in FIELD_ORDER, so an entry in
 * another order (the Python wrote `w, h, taken, lat, lon, located, blur`) gets `demEle` after `lon`; first when none is,
 * last for a key FIELD_ORDER doesn't know.
 */
function insertAt(entry: YAMLMap, k: string): number {
	const r = fieldRank(k);
	if (r === FIELD_ORDER.length) return entry.items.length; // a key FIELD_ORDER doesn't know goes last
	for (let i = entry.items.length - 1; i >= 0; i--) if (fieldRank(entry.items[i].key) < r) return i + 1;
	return 0;
}

/** Sets (undefined: removes) one field of an images entry: in place when it has it, else at its FIELD_ORDER place (insertAt). */
export function putScalar(entry: YAMLMap, k: string, value: string | number | undefined): void {
	if (value === undefined) {
		entry.delete(k);
		return;
	}
	const sc = new Scalar(value);
	if (typeof value === 'string' && k !== 'located') sc.type = Scalar.QUOTE_SINGLE;
	if (k === 'located') sc.type = Scalar.PLAIN;
	if (k === 'demEle') sc.minFractionDigits = 1;
	if (entry.has(k)) {
		entry.set(k, sc);
		return;
	}
	entry.items.splice(insertAt(entry, k), 0, new Pair(new Scalar(k), sc));
}

/** Immich could not be reached at all (network error or timeout), not an HTTP error answer: no point trying the rest. */
const unreachable = (e: unknown): boolean => e instanceof ImmichUnreachableError || e instanceof TypeError;

/**
 * Immich write-backs run after the front matter is written; a failure is reported, never thrown. After the first
 * unreachable-class failure the remaining linked keys get the same message without another call.
 */
async function writeBack(c: Ctx, items: { key: string; patch: Parameters<Immich['update']>[1] }[], deps: FixDeps): Promise<ImmichError[]> {
	const errors: ImmichError[] = [];
	let down: string | null = deps.immich ? null : 'Immich not configured — not written back';
	for (const { key, patch } of items) {
		const id = linkOf(c.root, c.links, key);
		if (!id) continue;
		if (down !== null) {
			errors.push({ key, message: down });
			continue;
		}
		try {
			await deps.immich!.update(id, patch);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			errors.push({ key, message });
			if (unreachable(e)) down = message;
		}
	}
	return errors;
}

const TAKEN_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2})$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Wall clock + offset of `taken`, shifted by `minutes`. The offset label is kept on purpose: the instant stays right across DST. */
function shiftTaken(taken: string, minutes: number): string | null {
	const m = TAKEN_RE.exec(taken);
	if (!m) return null;
	const wall = Date.parse(m[1] + 'Z');
	if (!Number.isFinite(wall)) return null;
	const d = new Date(wall + minutes * 60000);
	return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${m[2]}`;
}

const immichTime = (taken: string): string => taken.replace(/([+-]\d{2}:\d{2})$/, '.000$1');

/**
 * Sets `taken` on the given photos: to one value, or shifted by minutes (each photo keeps its own offset; untimed
 * photos are skipped and listed). Linked photos get `dateTimeOriginal` written back to Immich.
 */
export async function setTime(root: string, ref: DocRef, keys: string[], change: { taken: string } | { shiftMinutes: number }, base: string, deps: FixDeps = {}): Promise<{ version: string; skipped: string[]; immichErrors: ImmichError[] }> {
	const c = ctxOf(root, ref);
	if (!Array.isArray(keys) || !keys.length || keys.some((k) => typeof k !== 'string' || !k)) throw new ApiError(400, 'keys is required');
	let fixed: string | null = null;
	if ('taken' in change) {
		const m = typeof change.taken === 'string' ? TAKEN_RE.exec(change.taken) : null;
		if (!m || !Number.isFinite(Date.parse(m[1] + 'Z'))) throw new ApiError(400, 'taken must be a local time with offset, e.g. 2026-09-27T11:18:16+02:00');
		fixed = m[1] + m[2];
	} else if (!Number.isFinite(change.shiftMinutes) || Math.abs(change.shiftMinutes) > 7 * 24 * 60) throw new ApiError(400, 'shiftMinutes must be a number within 7 days');
	const out = await guarded(c, base, async () => {
		const skipped: string[] = [];
		const pending: { key: string; patch: { dateTimeOriginal: string } }[] = [];
		editEntry(c, keys, (key, entry) => {
			const cur = entry.get('taken');
			const next = fixed ?? (typeof cur === 'string' ? shiftTaken(cur, (change as { shiftMinutes: number }).shiftMinutes) : null);
			if (next === null) {
				skipped.push(key);
				return;
			}
			putScalar(entry, 'taken', next);
			pending.push({ key, patch: { dateTimeOriginal: immichTime(next) } });
		});
		// the version this call wrote, taken under the lock: a later external write must not be absorbed into it
		return { skipped, pending, version: versionOf(c) };
	});
	const immichErrors = await writeBack(c, out.pending, deps);
	return { version: out.version, skipped: out.skipped, immichErrors };
}

/**
 * Sets, derives or drops one photo's position. `{lat, lon}`: written (6 dp), `demEle` recomputed, `located` removed,
 * written back to Immich when linked. `{fromTrack: true}`: the recorded GPX position at `taken`, `located: track`, not
 * written back. `null`: drops lat, lon, demEle, located (Immich can't clear a location, so it keeps its own).
 */
export async function setLocation(root: string, ref: DocRef, key: string, pos: { lat: number; lon: number } | { fromTrack: true } | null, base: string, deps: FixDeps = {}): Promise<{ version: string; immichErrors: ImmichError[]; note?: string }> {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	if (pos && !('fromTrack' in pos)) {
		if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180) throw new ApiError(400, 'lat and lon must be valid coordinates');
	}
	const terrain = deps.terrain ?? createTerrain(repoPaths(root).demDir);
	const out = await guarded(c, base, async () => {
		const pending: { key: string; patch: { latitude: number; longitude: number } }[] = [];
		let note: string | undefined;
		editEntry(c, [key], (k, entry, doc) => {
			if (pos === null) {
				for (const f of ['lat', 'lon', 'demEle', 'located']) entry.delete(f);
				if (linkOf(root, c.links, k)) note = 'Immich keeps its location';
				return;
			}
			let lat: number;
			let lon: number;
			if ('fromTrack' in pos) {
				// A place doc's slug may also be a hike's: never borrow that hike's recording.
				if (c.ref.kind !== 'post') throw new ApiError(422, 'A place doc has no recorded track');
				const taken = entry.get('taken');
				const ms = typeof taken === 'string' ? Date.parse(taken) : NaN;
				if (!Number.isFinite(ms)) throw new ApiError(422, 'The photo has no time; set it first');
				const p = positionAt(recordedTrack(root, c.ref.slug, doc.toJS() ?? {}), ms);
				lat = round6(p.lat);
				lon = round6(p.lon);
				putScalar(entry, 'located', 'track');
			} else {
				lat = round6(pos.lat);
				lon = round6(pos.lon);
				entry.delete('located');
				pending.push({ key: k, patch: { latitude: lat, longitude: lon } });
			}
			putScalar(entry, 'lat', lat);
			putScalar(entry, 'lon', lon);
			putScalar(entry, 'demEle', terrain.height(lat, lon) ?? undefined);
		});
		return { pending, note, version: versionOf(c) };
	});
	const immichErrors = await writeBack(c, out.pending, deps);
	return { version: out.version, immichErrors, ...(out.note ? { note: out.note } : {}) };
}

/** Writes (or, with null/empty, removes) `images.<key>.alt`: the `alt` attribute on the site; the caption stays the figcaption. */
export async function setAlt(root: string, ref: DocRef, key: string, text: string | null, base: string): Promise<{ version: string }> {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	if (text !== null && typeof text !== 'string') throw new ApiError(400, 'text must be a string or null');
	const alt = text?.trim() || undefined;
	await guarded(c, base, async () => editEntry(c, [key], (_k, entry) => putScalar(entry, 'alt', alt)));
	return { version: versionOf(c) };
}

// ---------------------------------------------------------------- pins and caption

export type Pin = { ref: string; x: number; y: number };
const PIN_REF = /^(node|way|relation)\/\d+$/;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** osm.json, read once per call (the same reader as osm-service). */
function readOsmStore(root: string): Store {
	const file = repoPaths(root).osmStore;
	return existsSync(file) ? readStore(file) : {};
}

/** Validated pins, x/y rounded to 4 decimals; 400 for a malformed pin or a ref osm.json doesn't hold. */
function checkPins(root: string, pins: unknown): Pin[] {
	if (!Array.isArray(pins)) throw new ApiError(400, 'pins must be a list of {ref, x, y}');
	const store = pins.length ? readOsmStore(root) : {};
	return pins.map((p, i) => {
		const { ref, x, y } = (p ?? {}) as Record<string, unknown>;
		if (typeof ref !== 'string' || !PIN_REF.test(ref)) throw new ApiError(400, `pin ${i + 1}: ref must be node/…, way/… or relation/…`);
		if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new ApiError(400, `pin ${i + 1} (${ref}): x and y must be numbers from 0 to 1`);
		if (!Object.hasOwn(store, ref)) throw new ApiError(400, `${ref} is not in osm.json; add it to the store first`);
		return { ref, x: round4(x), y: round4(y) };
	});
}

/**
 * Writes `images.<key>.pins` (`[{ref: node/1, x: 0.1235, y: 0.5}]`, after `blur`) and clears `pinsReview`; an empty
 * list removes `pins`. Every ref must be in osm.json (400 otherwise).
 */
export async function setPins(root: string, ref: DocRef, key: string, pins: unknown, base: string): Promise<{ version: string; pins: Pin[] }> {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	const list = checkPins(root, pins);
	await guarded(c, base, async () =>
		editEntry(c, [key], (_k, entry, doc) => {
			entry.delete('pinsReview');
			if (!list.length) {
				entry.delete('pins');
				return;
			}
			const seq = doc.createNode(
				list.map((p) => {
					const m = doc.createNode({}) as YAMLMap;
					m.flow = true;
					m.set('ref', p.ref);
					m.set('x', p.x);
					m.set('y', p.y);
					return m;
				})
			) as YAMLSeq;
			seq.flow = true;
			entry.set('pins', seq);
		})
	);
	return { version: versionOf(c), pins: list };
}

type ImageLink = { altStart: number; altEnd: number; alt: string; href: string };

/** Markdown images `![alt](href …)` in `body`, the alt allowed to hold balanced brackets (`by [name](url)`). */
function imageLinks(body: string): ImageLink[] {
	const out: ImageLink[] = [];
	let i = body.indexOf('![');
	while (i >= 0) {
		const altStart = i + 2;
		let depth = 1;
		let j = altStart;
		for (; j < body.length && depth > 0; j++) {
			const ch = body[j];
			if (ch === '\\') j++;
			else if (ch === '[') depth++;
			else if (ch === ']') depth--;
			else if (ch === '\n' && body[j + 1] === '\n') break;
		}
		if (depth === 0 && body[j] === '(') {
			const m = /^\(\s*<?([^)\s>]+)/.exec(body.slice(j));
			if (m) out.push({ altStart, altEnd: j - 1, alt: body.slice(altStart, j - 1), href: m[1] });
		}
		i = body.indexOf('![', altStart);
	}
	return out;
}

/** The image links that show `key`: its full href, or (bare key) any target ending in `/<key>`. */
function linksOf(body: string, key: string, href: string): ImageLink[] {
	return imageLinks(body).filter((l) => l.href === href || (!key.startsWith('/') && l.href.endsWith('/' + key)));
}

export const CAPTION_NOT_PLACED = 'The photo is not placed in the text yet: add it in Write first';
export const CAPTION_AMBIGUOUS = 'The photo is in the text more than once: edit its caption in Write';

function balanced(text: string): boolean {
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\\') {
			// a lone backslash at the end would escape the closing `]`
			if (++i >= text.length) return false;
		} else if (text[i] === '[') depth++;
		else if (text[i] === ']' && --depth < 0) return false;
	}
	return depth === 0;
}

/**
 * Replaces the caption (alt text) of the one markdown image line showing `key`; only those bytes of the post change.
 * 409 when the photo is not placed in the text, or placed more than once.
 */
export async function setCaption(root: string, ref: DocRef, key: string, text: string, base: string): Promise<{ version: string; caption: string }> {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	if (typeof text !== 'string') throw new ApiError(400, 'text must be a string');
	const caption = text.trim();
	if (/[\r\n]/.test(caption)) throw new ApiError(400, 'The caption must be one line');
	if (!balanced(caption)) throw new ApiError(400, 'The caption has an unmatched [ or ], or ends in a lone \\');
	await guarded(c, base, async () => {
		const { raw, body } = readPost(c);
		const links = linksOf(body, key, hrefOf(key, c.own));
		if (!links.length) throw new ApiError(409, CAPTION_NOT_PLACED);
		if (links.length > 1) throw new ApiError(409, CAPTION_AMBIGUOUS);
		const off = raw.length - body.length;
		const l = links[0];
		if (l.alt === caption) return;
		writeAllAtomic([[c.pp, raw.slice(0, off + l.altStart) + caption + raw.slice(off + l.altEnd)]]);
	});
	return { version: versionOf(c), caption };
}

export type PinView = Pin & { name: string | null; ele: number | null; lat: number | null; lon: number | null; missing: boolean };
export type PinState = {
	key: string;
	href: string;
	w?: number;
	h?: number;
	lat?: number;
	lon?: number;
	pins: PinView[];
	pinsReview: boolean;
	/** The caption of the photo's one image line; null unless `captionState` is ok. */
	caption: string | null;
	captionState: 'ok' | 'missing' | 'ambiguous';
};

const eleOf = (tags: Record<string, unknown>): number | null => {
	const v = typeof tags.ele === 'string' ? parseFloat(tags.ele.replace(',', '.')) : NaN;
	return Number.isFinite(v) ? Math.round(v) : null;
};

/** One photo's pins (with the store's name and position for each) and its caption, for the pin editor. */
export function pinState(root: string, ref: DocRef, key: string): PinState {
	const c = ctxOf(root, ref);
	if (typeof key !== 'string' || !key) throw new ApiError(400, 'key is required');
	const { doc, body } = readPost(c);
	const entry = imagesMap(doc)?.get(key, true);
	if (!isMap(entry)) throw new ApiError(404, `No image ${key} in ${docName(c)}`);
	const im = entry.toJSON() as Record<string, unknown>;
	const href = hrefOf(key, c.own);
	const raw = Array.isArray(im.pins) ? im.pins : [];
	const store = raw.length ? readOsmStore(root) : {};
	const pins: PinView[] = raw.map((p: any) => {
		const ref = String(p?.ref ?? '');
		const e = PIN_REF.test(ref) && Object.hasOwn(store, ref) ? store[ref] : null;
		const tags = e ? ({ ...(e.tags ?? {}), ...(e.local ?? {}) } as Record<string, unknown>) : {};
		return { ref, x: Number(p?.x), y: Number(p?.y), name: typeof tags.name === 'string' ? tags.name : null, ele: eleOf(tags), lat: e?.lat ?? null, lon: e?.lon ?? null, missing: !e };
	});
	const links = linksOf(body, key, href);
	const out: PinState = {
		key,
		href,
		pins,
		pinsReview: im.pinsReview === true,
		caption: links.length === 1 ? links[0].alt : null,
		captionState: links.length === 1 ? 'ok' : links.length ? 'ambiguous' : 'missing'
	};
	for (const k of ['w', 'h', 'lat', 'lon'] as const) if (typeof im[k] === 'number') out[k] = im[k] as number;
	return out;
}

// Immich (v3) client for the photo features: metadata search, cached thumbnails, originals, and the bulk asset update.
// v3 notes (as the former scripts/matches/immich.py found): album contents come from POST /api/search/metadata with albumIds, not GET /api/albums/{id};
// search pages through `nextPage`. PUT /api/assets (AssetBulkUpdateDto: ids, dateTimeOriginal, latitude, longitude) is marked deprecated in the
// v3.0.1 spec but is the only bulk update there. The API key goes only into the x-api-key header and is never logged.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors';

export type Asset = { id: string; fileName: string; takenLocal: string; width: number; height: number; lat?: number; lon?: number; fileSize?: number };
export type ThumbSize = 'thumbnail' | 'preview';
export type SearchQuery = { albumId?: string; takenAfter?: string; takenBefore?: string; page?: number };
export type ImmichUpdate = { dateTimeOriginal?: string; latitude?: number | null; longitude?: number | null };
export type Immich = {
	albums(): Promise<{ id: string; name: string }[]>;
	search(q: SearchQuery): Promise<Asset[]>;
	smart(query: string, limit?: number): Promise<Asset[]>;
	asset(id: string): Promise<Asset>;
	thumb(id: string, size: ThumbSize): Promise<Buffer>;
	original(id: string): Promise<{ bytes: Buffer; fileName: string }>;
	update(id: string, patch: ImmichUpdate): Promise<void>;
};

/** Immich could not be reached at all (network error or timeout), as opposed to an HTTP error answer. */
export class ImmichUnreachableError extends ApiError {
	constructor(timeout: boolean) {
		super(502, timeout ? UNREACHABLE_TIMEOUT : UNREACHABLE);
	}
}

const isTimeout = (e: unknown): boolean => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

export const DEFAULT_CAP = 1_000_000_000;
const PAGE_SIZE = 200;
/** API calls give up after this long; original downloads (tens of MB) get longer. */
export const API_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const UNREACHABLE = 'Immich unreachable';
export const UNREACHABLE_TIMEOUT = 'Immich unreachable (timeout)';
const MISSING = 'Set immichUrl and immichKey (scripts/crm/data/settings.json or IMMICH_URL / IMMICH_API_KEY)';

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

function offsetString(minutes: number): string {
	return `${minutes < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** Offset in minutes east of UTC for an IANA zone or Immich's "UTC+2" / "UTC-3:30" form at the given instant; null when unknown. */
function zoneOffsetMinutes(zone: string, at: Date): number | null {
	const m = /^UTC(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(zone);
	if (m) return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
	try {
		const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
		const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
		const wall = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
		return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
	} catch {
		return null;
	}
}

/** Local wall clock with offset, e.g. 2026-09-27T11:18:16+02:00. */
function wallWithOffset(instant: Date, offsetMin: number): string {
	const d = new Date(instant.getTime() + offsetMin * 60000);
	return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${offsetString(offsetMin)}`;
}

function takenLocalOf(raw: any): string {
	const ex = raw.exifInfo ?? {};
	const taken = ex.dateTimeOriginal ? new Date(ex.dateTimeOriginal) : null;
	if (taken && !Number.isNaN(taken.getTime())) {
		const off = typeof ex.timeZone === 'string' ? zoneOffsetMinutes(ex.timeZone, taken) : null;
		if (off !== null) return wallWithOffset(taken, off);
	}
	// localDateTime is the wall clock written as if it were UTC; the offset is its distance from the true instant.
	const local = raw.localDateTime ? new Date(raw.localDateTime) : null;
	if (local && !Number.isNaN(local.getTime())) {
		const real = taken ?? (raw.fileCreatedAt ? new Date(raw.fileCreatedAt) : null);
		const off = real && !Number.isNaN(real.getTime()) ? Math.round((local.getTime() - real.getTime()) / 900000) * 15 : 0;
		return wallWithOffset(new Date(local.getTime() - off * 60000), off);
	}
	return taken && !Number.isNaN(taken.getTime()) ? wallWithOffset(taken, 0) : '';
}

export function assetFromRaw(raw: any): Asset {
	const ex = raw.exifInfo ?? {};
	// Asset width/height are upright; exifImageWidth/Height are as stored (pre-rotation), so only they swap for orientation 5-8.
	let width = Number(raw.width || 0);
	let height = Number(raw.height || 0);
	if (!(width > 0 && height > 0)) {
		width = Number(ex.exifImageWidth || 0);
		height = Number(ex.exifImageHeight || 0);
		if (Number(ex.orientation) >= 5 && Number(ex.orientation) <= 8) [width, height] = [height, width];
	}
	const a: Asset = { id: String(raw.id), fileName: String(raw.originalFileName ?? raw.originalPath?.split('/').pop() ?? ''), takenLocal: takenLocalOf(raw), width, height };
	if (typeof ex.latitude === 'number' && typeof ex.longitude === 'number') {
		a.lat = ex.latitude;
		a.lon = ex.longitude;
	}
	if (typeof ex.fileSizeInByte === 'number' && ex.fileSizeInByte > 0) a.fileSize = ex.fileSizeInByte;
	return a;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function checkId(id: string): void {
	if (!SAFE_ID.test(id)) throw new ApiError(400, `Bad asset id ${id}`);
}

export function createImmich(opts: { url?: string; key?: string; fetch?: typeof fetch; cacheDir: string; capBytes?: number; timeoutMs?: number; downloadTimeoutMs?: number }): Immich {
	const cap = opts.capBytes ?? DEFAULT_CAP;
	const doFetch = opts.fetch ?? fetch;

	/** The signal also bounds reading the body (bytesOf / res.json()), so a stalled transfer times out too. */
	async function call(route: string, init: { method?: string; json?: unknown; timeoutMs?: number } = {}): Promise<Response> {
		if (!opts.url || !opts.key) throw new ApiError(400, MISSING);
		const headers: Record<string, string> = { 'x-api-key': opts.key };
		if (init.json !== undefined) headers['content-type'] = 'application/json';
		let res: Response;
		try {
			const signal = AbortSignal.timeout(init.timeoutMs ?? opts.timeoutMs ?? API_TIMEOUT_MS);
			res = await doFetch(opts.url.replace(/\/+$/, '') + route, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json), signal });
		} catch (e) {
			throw new ImmichUnreachableError(isTimeout(e));
		}
		if (!res.ok) throw new ApiError(502, `Immich ${init.method ?? 'GET'} ${route.split('?')[0].replace(/[0-9a-f-]{36}/g, ':id')}: HTTP ${res.status}`);
		return res;
	}
	const bytesOf = async (res: Response): Promise<Buffer> => {
		try {
			return Buffer.from(await res.arrayBuffer());
		} catch (e) {
			throw new ImmichUnreachableError(isTimeout(e));
		}
	};
	const jsonOf = async (res: Response): Promise<any> => {
		try {
			return await res.json();
		} catch (e) {
			if (isTimeout(e)) throw new ImmichUnreachableError(true);
			throw new ApiError(502, 'Immich sent an unreadable answer');
		}
	};

	async function paged(endpoint: 'metadata' | 'smart', body: Record<string, unknown>, firstPage = 1, limit?: number): Promise<Asset[]> {
		const out: Asset[] = [];
		let page = firstPage;
		while (limit === undefined || out.length < limit) {
			const res = await call(`/api/search/${endpoint}`, { method: 'POST', json: { ...body, page, withExif: true, type: 'IMAGE' } });
			const block = (await jsonOf(res))?.assets ?? {};
			const items: any[] = (block.items ?? []).filter((i: any) => i.type === undefined || i.type === 'IMAGE');
			out.push(...items.map(assetFromRaw));
			const next = Number(block.nextPage);
			if (!block.nextPage || !Number.isFinite(next) || (limit !== undefined && !(block.items ?? []).length)) break;
			page = next;
		}
		return limit === undefined ? out : out.slice(0, limit);
	}

	// Running view of the cache (like mapy-tiles.ts): read from disk once, then kept in step with writes and evictions.
	let index: Map<string, { size: number; mtimeMs: number }> | null = null;
	let total = 0;
	function loadIndex(): Map<string, { size: number; mtimeMs: number }> {
		if (index) return index;
		index = new Map();
		let names: string[] = [];
		try {
			names = readdirSync(opts.cacheDir).filter((f) => f.endsWith('.img'));
		} catch {
			/* no cache dir yet */
		}
		for (const f of names) {
			const st = statSync(path.join(opts.cacheDir, f));
			index.set(f, { size: st.size, mtimeMs: st.mtimeMs });
			total += st.size;
		}
		return index;
	}
	let clock = 0;
	const stamp = (): number => (clock = Math.max(Date.now(), clock + 1)); // strictly increasing, so recency order never ties
	function record(name: string, size: number): void {
		const idx = loadIndex();
		total += size - (idx.get(name)?.size ?? 0);
		idx.set(name, { size, mtimeMs: stamp() });
		if (total <= cap) return;
		for (const [f, x] of [...idx].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs)) {
			if (total <= cap) break;
			if (f === name) continue;
			try {
				unlinkSync(path.join(opts.cacheDir, f));
			} catch {
				/* already gone */
			}
			idx.delete(f);
			total -= x.size;
		}
	}

	async function loadThumb(id: string, size: ThumbSize, file: string): Promise<Buffer> {
		try {
			const hit = readFileSync(file);
			const e = loadIndex().get(path.basename(file));
			if (e) e.mtimeMs = stamp(); // a hit makes it the most recently used
			return hit;
		} catch {
			/* miss */
		}
		const res = await call(`/api/assets/${id}/thumbnail?size=${size}`);
		const buf = await bytesOf(res);
		mkdirSync(opts.cacheDir, { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		try {
			writeFileSync(tmp, buf);
			loadIndex(); // before the rename, so the new file is not counted twice
			renameSync(tmp, file);
		} catch (e) {
			try {
				unlinkSync(tmp);
			} catch {
				/* nothing to clean */
			}
			throw e;
		}
		record(path.basename(file), buf.length);
		return buf;
	}
	const pending = new Map<string, Promise<Buffer>>();
	const getAsset = async (id: string): Promise<Asset> => {
		checkId(id);
		return assetFromRaw(await jsonOf(await call(`/api/assets/${id}`)));
	};

	return {
		async albums() {
			const list = ((await jsonOf(await call('/api/albums'))) as any[]) ?? [];
			return list.map((a) => ({ id: String(a.id), name: String(a.albumName ?? '') }));
		},
		search(q) {
			const body: Record<string, unknown> = { size: PAGE_SIZE };
			if (q.albumId) body.albumIds = [q.albumId];
			if (q.takenAfter) body.takenAfter = q.takenAfter;
			if (q.takenBefore) body.takenBefore = q.takenBefore;
			return paged('metadata', body, q.page ?? 1);
		},
		smart: (query, limit = 200) => paged('smart', { query, size: Math.min(limit, PAGE_SIZE) }, 1, limit),
		asset: getAsset,
		async thumb(id, size) {
			checkId(id);
			if (size !== 'thumbnail' && size !== 'preview') throw new ApiError(400, `Bad size ${size}`);
			const file = path.join(opts.cacheDir, `${id}-${size}.img`);
			let p = pending.get(file);
			if (!p) {
				p = loadThumb(id, size, file).finally(() => pending.delete(file));
				pending.set(file, p);
			}
			return p;
		},
		async original(id) {
			checkId(id);
			const meta = await getAsset(id);
			return { bytes: await bytesOf(await call(`/api/assets/${id}/original`, { timeoutMs: opts.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS })), fileName: meta.fileName };
		},
		async update(id, patch) {
			checkId(id);
			if (patch.latitude === null || patch.longitude === null) throw new ApiError(400, "Immich can't clear a location");
			const body: Record<string, unknown> = { ids: [id] };
			for (const k of ['dateTimeOriginal', 'latitude', 'longitude'] as const) if (patch[k] !== undefined) body[k] = patch[k];
			await call('/api/assets', { method: 'PUT', json: body });
		}
	};
}

const STUB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/immich-stub');

/** CRM_IMMICH_STUB=1: serves fixtures/immich-stub/ in memory; updates live only for the process. */
export function createStubImmich(dir: string = STUB_DIR): Immich {
	const data = JSON.parse(readFileSync(path.join(dir, 'assets.json'), 'utf8')) as { albums: any[]; assets: any[] };
	const raws: any[] = data.assets.map((a) => structuredClone(a));
	const find = (id: string) => {
		const r = raws.find((x) => x.id === id);
		if (!r) throw new ApiError(404, `Unknown asset ${id}`);
		return r;
	};
	const instant = (a: Asset) => new Date(a.takenLocal).getTime();
	const file = (id: string) => path.join(dir, `${find(id).id}.jpg`);
	return {
		albums: async () => data.albums.map((a) => ({ id: a.id, name: a.albumName })),
		search: async (q) =>
			raws
				.filter((r) => !q.albumId || (r.albumIds ?? []).includes(q.albumId))
				.map(assetFromRaw)
				.filter((a) => (!q.takenAfter || instant(a) >= Date.parse(q.takenAfter)) && (!q.takenBefore || instant(a) <= Date.parse(q.takenBefore))),
		smart: async (_q, limit = 200) => raws.map(assetFromRaw).slice(0, limit),
		asset: async (id) => assetFromRaw(find(id)),
		thumb: async (id) => readFileSync(file(id)),
		original: async (id) => ({ bytes: readFileSync(file(id)), fileName: find(id).originalFileName }),
		update: async (id, patch) => {
			const r = find(id);
			r.exifInfo ??= {};
			if (patch.latitude !== undefined) r.exifInfo.latitude = patch.latitude ?? undefined;
			if (patch.longitude !== undefined) r.exifInfo.longitude = patch.longitude ?? undefined;
			if (patch.dateTimeOriginal) {
				const d = new Date(patch.dateTimeOriginal);
				if (!Number.isNaN(d.getTime())) r.exifInfo.dateTimeOriginal = d.toISOString();
			}
		}
	};
}

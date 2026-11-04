// OSM API (elements by typed id) and Overpass (around / name search) clients; port of the former scripts/matches/osmapi.py and overpass.py.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors';

export type RawElement = {
	type: 'node' | 'way' | 'relation';
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags: Record<string, string>;
	/** An area the point is inside (openstreetmap.org's "Enclosing features"), not one near it. */
	enclosing?: true;
};

export type OsmClient = {
	elements(refs: string[]): Promise<Record<string, RawElement>>;
	around(lat: number, lon: number, radiusM: number): Promise<RawElement[]>;
	searchName(name: string, lat: number, lon: number, radiusM?: number, limit?: number): Promise<RawElement[]>;
};

export const API_URL = 'https://api.openstreetmap.org/api/0.6';
/** What openstreetmap.org's "Query features" asks (same queries, one click's worth each); Overpass is the fallback. */
export const QUERY_FEATURES_URL = 'https://query.openstreetmap.org/query-features';
/**
 * openstreetmap.org's Query features page: its answer sets the `_osm_totp_token` cookie (about an hour long) that
 * query-features wants back; the site sets it on any of its pages, this one is the smallest (the sidebar frame alone).
 */
export const QUERY_PAGE_URL = 'https://www.openstreetmap.org/query';
export const TOTP_COOKIE = '_osm_totp_token';
export const OVERPASS_URLS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
const USER_AGENT = 'mykolamor.com hike CRM (scripts/crm)';
const BATCH = 100;
const API_GAP_MS = 500;
const OVERPASS_GAP_MS = 1000;
/** A mirror that hasn't answered by then is treated as busy: the next one is asked. */
const OVERPASS_WAIT_MS = 20000;
const QUERY_FEATURES_WAIT_MS = 15000;
/** A token is renewed this long before the cookie's expiry; one without an expiry is kept this long. */
const TOKEN_MARGIN_MS = 60000;
const TOKEN_DEFAULT_MS = 30 * 60000;
/** How query-features refuses a missing or stale token: the token is fetched anew and the query sent once more. */
const TOKEN_REFUSED = new Set([401, 403]);
/** Enclosing areas wider than this (a country, a time zone, the Alps) are left out: no use as a hike node, and huge to fetch. */
const ENCLOSING_MAX_M = 20000;
const BUSY = new Set([429, 502, 503, 504]);
const REGEX_SPECIAL = new Set('\\.^$*+?()[]{}|');

type FetchFn = typeof globalThis.fetch;

function qlString(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function regexLiteral(text: string): string {
	return [...text].map((c) => (REGEX_SPECIAL.has(c) ? '\\' + c : c)).join('');
}

type Pt = { lat: number; lon: number };
const isPt = (p: any): p is Pt => !!p && typeof p.lat === 'number' && typeof p.lon === 'number';

/**
 * The element's point nearest `at`, from the geometry `out geom(bbox)` gives (a way's nodes, a relation's members',
 * clipped to the box); its bounds' centre when none of it is in the box.
 */
export function nearestPoint(el: any, at: Pt): Pt | null {
	const pts: Pt[] = [];
	const add = (g: any) => (isPt(g) ? pts.push({ lat: g.lat, lon: g.lon }) : Array.isArray(g) && g.forEach((p) => isPt(p) && pts.push({ lat: p.lat, lon: p.lon })));
	add(el.geometry);
	for (const m of Array.isArray(el.members) ? el.members : []) (add(m.geometry), add(m));
	const cos = Math.cos((at.lat * Math.PI) / 180);
	const d = (p: Pt) => (p.lat - at.lat) ** 2 + ((p.lon - at.lon) * cos) ** 2;
	if (pts.length) return pts.reduce((a, b) => (d(b) < d(a) ? b : a));
	const b = el.bounds;
	return b && [b.minlat, b.minlon, b.maxlat, b.maxlon].every((v) => typeof v === 'number') ? { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 } : null;
}

/** Lat/lon box `m` metres around `p`, as Overpass's `(south,west,north,east)`. */
function boxAround(p: Pt, m: number): string {
	const dLat = m / 111320;
	const dLon = m / (111320 * Math.cos((p.lat * Math.PI) / 180));
	const r = (v: number) => Math.round(v * 1e7) / 1e7;
	return `${r(p.lat - dLat)},${r(p.lon - dLon)},${r(p.lat + dLat)},${r(p.lon + dLon)}`;
}

/** The diagonal of an element's `bounds`, in metres (Infinity without bounds). */
function boundsSpanM(b: any): number {
	if (!b || ![b.minlat, b.minlon, b.maxlat, b.maxlon].every((v) => typeof v === 'number')) return Infinity;
	const cos = Math.cos((((b.minlat + b.maxlat) / 2) * Math.PI) / 180);
	return Math.hypot((b.maxlat - b.minlat) * 111320, (b.maxlon - b.minlon) * 111320 * cos);
}

/** Overpass JSON elements as `RawElement`s placed at their point nearest `at` (`center`), geometry dropped. */
function placed(els: any[], at: Pt): RawElement[] {
	return els.map((e) => {
		const { geometry: _g, members: _m, bounds: _b, ...rest } = e;
		const el = { ...rest, tags: e.tags ?? {} } as RawElement;
		if (e.type === 'node') return el;
		const c = nearestPoint(e, at);
		return c ? { ...el, center: c } : el;
	});
}

/**
 * The enclosing query lists a way twice (`out tags bb`, then `out ids geom`): merged by id, kept when at most
 * `ENCLOSING_MAX_M` across, and placed at the clicked point (inside them all).
 */
function enclosingAreas(els: any[], at: Pt): RawElement[] {
	const byRef = new Map<string, any>();
	for (const e of els) {
		const ref = `${e.type}/${e.id}`;
		byRef.set(ref, { ...byRef.get(ref), ...e, tags: { ...byRef.get(ref)?.tags, ...e.tags } });
	}
	return [...byRef.values()]
		.filter((e) => e.type !== 'node' && boundsSpanM(e.bounds) <= ENCLOSING_MAX_M)
		.map((e) => ({ type: e.type, id: e.id, tags: e.tags ?? {}, center: { lat: at.lat, lon: at.lon }, enclosing: true as const }));
}

function shape(el: any): RawElement {
	const out: RawElement = { type: el.type, id: el.id, tags: { ...(el.tags ?? {}) } };
	if (el.type === 'node') {
		out.lat = el.lat;
		out.lon = el.lon;
	}
	return out;
}

export function createOsmClient(
	deps: {
		fetch?: FetchFn;
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
		apiUrl?: string;
		overpassUrls?: string[];
		queryFeaturesUrl?: string;
		queryPageUrl?: string;
		/** Where a busy mirror or a fallback is told (the terminal running `pnpm crm`). */
		log?: (msg: string) => void;
	} = {}
): OsmClient {
	const doFetch = deps.fetch ?? globalThis.fetch;
	const now = deps.now ?? Date.now;
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const apiUrl = deps.apiUrl ?? API_URL;
	const urls = deps.overpassUrls ?? OVERPASS_URLS;
	const queryFeaturesUrl = deps.queryFeaturesUrl ?? QUERY_FEATURES_URL;
	const queryPageUrl = deps.queryPageUrl ?? QUERY_PAGE_URL;
	const log = deps.log ?? ((m: string) => console.warn(`[crm] ${m}`));
	const host = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};
	/** The start of a refused response's body for the log: tags dropped, whitespace collapsed, at most 300 characters. */
	const snippet = async (res: Response): Promise<string> => {
		let text = '';
		try {
			text = await res.text();
		} catch {
			return '(no body)';
		}
		const flat = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
		return flat ? JSON.stringify(flat.length > 300 ? `${flat.slice(0, 300)}…` : flat) : '(empty body)';
	};
	const why = (e: unknown) => (e instanceof Error ? (e.name === 'TimeoutError' ? 'no answer in time' : e.message) : String(e));
	const last = { api: -Infinity, overpass: -Infinity };

	async function pace(kind: 'api' | 'overpass', gap: number) {
		const wait = last[kind] + gap - now();
		if (wait > 0) await sleep(wait);
	}

	/** One OSM API GET; null for 404/410. */
	async function apiGet(p: string): Promise<any[] | null> {
		await pace('api', API_GAP_MS);
		let res: Response;
		try {
			res = await doFetch(`${apiUrl}/${p}`, { headers: { 'User-Agent': USER_AGENT } });
		} catch (e) {
			throw new ApiError(502, `OSM API unreachable: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			last.api = now();
		}
		if (res.status === 404 || res.status === 410) return null;
		if (!res.ok) log(`OSM API ${p.split('?')[0]} answered ${res.status}: ${await snippet(res)}`);
		if (BUSY.has(res.status)) throw new ApiError(503, 'OSM is busy — try again in a minute');
		if (!res.ok) throw new ApiError(502, `OSM API answered ${res.status}`);
		return ((await res.json()) as { elements?: any[] }).elements ?? [];
	}

	/** Elements of one type; a batch with an unknown id answers 404 as a whole, so it is halved until that id is alone. */
	async function many(kind: string, ids: string[]): Promise<any[]> {
		const found = await apiGet(`${kind}s.json?${kind}s=${ids.join(',')}`);
		if (found !== null) return found;
		if (ids.length === 1) return [];
		const mid = Math.floor(ids.length / 2);
		return [...(await many(kind, ids.slice(0, mid))), ...(await many(kind, ids.slice(mid)))];
	}

	async function centre(kind: string, num: string): Promise<{ lat: number; lon: number } | null> {
		const full = (await apiGet(`${kind}/${num}/full.json`)) ?? [];
		const pts = full.filter((e) => e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number');
		if (!pts.length) return null;
		const lats = pts.map((e) => e.lat as number);
		const lons = pts.map((e) => e.lon as number);
		return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
	}

	async function elements(refs: string[]): Promise<Record<string, RawElement>> {
		const byKind = new Map<string, string[]>();
		for (const ref of new Set(refs)) {
			const [kind, num] = ref.split('/');
			byKind.set(kind, [...(byKind.get(kind) ?? []), num]);
		}
		const found: Record<string, RawElement> = {};
		for (const [kind, nums] of byKind) {
			for (let i = 0; i < nums.length; i += BATCH) {
				for (const el of await many(kind, nums.slice(i, i + BATCH))) {
					if (el.visible === false) continue;
					found[`${el.type}/${el.id}`] = shape(el);
				}
			}
		}
		for (const el of Object.values(found)) {
			if (el.type === 'node') continue;
			const c = await centre(el.type, String(el.id));
			if (c) el.center = c;
		}
		return found;
	}

	/** Overpass query with mirror failover: busy (or unreachable) mirrors hand over to the next, in order. */
	async function query(ql: string): Promise<RawElement[]> {
		for (const url of urls) {
			await pace('overpass', OVERPASS_GAP_MS);
			let res: Response | null = null;
			try {
				res = await doFetch(url, {
					method: 'POST',
					headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ data: ql }).toString(),
					signal: AbortSignal.timeout(OVERPASS_WAIT_MS)
				});
			} catch (e) {
				log(`Overpass ${host(url)}: ${why(e)}, trying the next mirror`);
				res = null;
			} finally {
				last.overpass = now();
			}
			if (res && BUSY.has(res.status)) log(`Overpass ${host(url)} busy (${res.status}), trying the next mirror: ${await snippet(res)}`);
			if (!res || BUSY.has(res.status)) continue;
			if (!res.ok) {
				log(`Overpass ${host(url)} answered ${res.status}: ${await snippet(res)}`);
				throw new ApiError(502, `Overpass answered ${res.status}`);
			}
			const body = (await res.json()) as { elements?: RawElement[]; remark?: string };
			// A query cut short (time or memory) still answers 200, with what it had and a remark saying so.
			if (body.remark) log(`Overpass ${host(url)} remark: ${JSON.stringify(body.remark.slice(0, 300))}`);
			return (body.elements ?? []).map((e) => ({ ...e, tags: e.tags ?? {} }));
		}
		throw new ApiError(503, 'OSM is busy — try again in a minute');
	}

	/** The current `_osm_totp_token` (shared by the nearby and enclosing queries sent together) and when to renew it. */
	let token: { value: string; renewAt: number } | null = null;
	let tokenFetch: Promise<string> | null = null;

	/**
	 * The site's own first step: open its Query features page (as the sidebar frame it loads on a click) and keep the
	 * `_osm_totp_token` it sets. Its lifetime is the cookie's expiry against the answer's Date, so the local clock's
	 * offset from the server's doesn't matter.
	 */
	async function fetchToken(lat: number, lon: number): Promise<string> {
		const res = await doFetch(`${queryPageUrl}?lat=${lat}&lon=${lon}`, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, application/xhtml+xml', 'turbo-frame': 'sidebar_content_frame' },
			signal: AbortSignal.timeout(QUERY_FEATURES_WAIT_MS)
		});
		if (!res.ok) throw new Error(`token page answered ${res.status}: ${await snippet(res)}`);
		const cookie = res.headers.getSetCookie().find((c) => c.trimStart().startsWith(`${TOTP_COOKIE}=`));
		if (!cookie) throw new Error(`token page set no ${TOTP_COOKIE} cookie`);
		const [pair, ...attrs] = cookie.split(';');
		const value = pair.slice(pair.indexOf('=') + 1).trim();
		if (!value) throw new Error(`token page set an empty ${TOTP_COOKIE} cookie`);
		const attr = (name: string) => attrs.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1);
		const maxAge = attr('max-age') === undefined ? NaN : Number(attr('max-age'));
		const expires = Date.parse(attr('expires') ?? '');
		const served = Date.parse(res.headers.get('date') ?? '');
		const lifeMs = Number.isFinite(maxAge) ? maxAge * 1000 : Number.isFinite(expires - served) ? expires - served : TOKEN_DEFAULT_MS;
		token = { value, renewAt: now() + Math.max(0, lifeMs - TOKEN_MARGIN_MS) };
		return value;
	}

	/** The kept token while it is fresh, else one fetch of a new one (concurrent callers wait on the same fetch). */
	function currentToken(lat: number, lon: number, renew = false): Promise<string> {
		if (renew) token = null;
		if (token && now() < token.renewAt) return Promise.resolve(token.value);
		tokenFetch ??= fetchToken(lat, lon).finally(() => (tokenFetch = null));
		return tokenFetch;
	}

	/**
	 * One POST to openstreetmap.org's Query features endpoint, as the site sends it (its Origin and Referer, the
	 * `_osm_totp_token` cookie; the CRM's User-Agent); a refused token is renewed once. Throws on any failure.
	 */
	async function queryFeatures(ql: string, at: Pt): Promise<any[]> {
		const post = async (renew: boolean) =>
			doFetch(queryFeaturesUrl, {
				method: 'POST',
				headers: {
					Origin: 'https://www.openstreetmap.org',
					Referer: 'https://www.openstreetmap.org/',
					'User-Agent': USER_AGENT,
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
					Cookie: `${TOTP_COOKIE}=${await currentToken(at.lat, at.lon, renew)}`
				},
				body: new URLSearchParams({ data: ql }).toString(),
				signal: AbortSignal.timeout(QUERY_FEATURES_WAIT_MS)
			});
		let res = await post(false);
		if (TOKEN_REFUSED.has(res.status)) {
			log(`OSM Query features refused the token (${res.status}): ${await snippet(res)}, fetching a new one`);
			res = await post(true);
		}
		if (!res.ok) throw new Error(`answered ${res.status}: ${await snippet(res)}`);
		const body = (await res.json()) as { elements?: unknown; remark?: string };
		const remark = body.remark ? ` (remark: ${JSON.stringify(body.remark.slice(0, 300))})` : '';
		if (!Array.isArray(body.elements)) throw new Error(`answered without elements${remark}`);
		if (remark) log(`OSM Query features answered with a remark${remark}`);
		const els = body.elements;
		return els;
	}

	/** The fallback: the same nearby lookup on the public Overpass mirrors (geometry clipped to a small box). */
	async function overpassAround(lat: number, lon: number, r: number): Promise<RawElement[]> {
		const at = `(around:${r},${lat},${lon})(if:count_tags()>0)`;
		return placed(await query(`[out:json][timeout:10];(node${at};way${at};relation${at};);out tags geom(${boxAround({ lat, lon }, r)});`), { lat, lon });
	}

	return {
		elements,
		// openstreetmap.org's "Query features" flow: its nearby and enclosing queries, sent together as the site sends them
		// (`out center` is avoided: Overpass would assemble every member of a long route relation passing by). Each element
		// sits at its point nearest the click; an enclosing area at the click. The nearby query failing falls back to the
		// Overpass mirrors; the enclosing one failing just leaves the areas out.
		around: async (lat, lon, r) => {
			const at = { lat, lon };
			const box = boxAround(at, r);
			const near = `(around:${r},${lat},${lon})`;
			let nearby: RawElement[];
			let enclosing: RawElement[] = [];
			try {
				const [n, e] = await Promise.all([
					queryFeatures(`[timeout:10][out:json];(node${near};way${near};);out tags geom(${box});relation${near};out geom(${box});`, at),
					queryFeatures(`[timeout:10][out:json];is_in(${lat},${lon})->.a;way(pivot.a);out tags bb;out ids geom(${box});relation(pivot.a);out tags bb;`, at).catch(
						(err) => err as Error
					)
				]);
				nearby = placed(n, at);
				// Told only beside a working nearby lookup; when both fail, the fallback line says it.
				if (e instanceof Error) log(`OSM Query features (enclosing areas): ${why(e)}, listing nearby objects only`);
				else enclosing = enclosingAreas(e, at);
			} catch (err) {
				log(`OSM Query features: ${why(err)}, asking the Overpass mirrors instead`);
				return overpassAround(lat, lon, r);
			}
			const seen = new Set(nearby.map((e) => `${e.type}/${e.id}`));
			return [...nearby, ...enclosing.filter((e) => !seen.has(`${e.type}/${e.id}`))];
		},
		searchName: (name, lat, lon, radiusM = 30000, limit = 20) => {
			const pattern = qlString(regexLiteral(name.trim()));
			return query(`[out:json][timeout:30];nwr["name"~"${pattern}",i](around:${radiusM},${lat},${lon});out center tags ${limit};`);
		}
	};
}

/** Canned elements from fixtures/osm-stub.json (CRM_OSM_STUB=1), no network. */
export function createStubClient(file = fileURLToPath(new URL('./fixtures/osm-stub.json', import.meta.url))): OsmClient {
	const data = JSON.parse(readFileSync(file, 'utf-8')) as { elements: Record<string, RawElement>; around: RawElement[] };
	return {
		async elements(refs) {
			const out: Record<string, RawElement> = {};
			for (const r of refs) if (data.elements[r]) out[r] = data.elements[r];
			return out;
		},
		async around() {
			return data.around;
		},
		async searchName(name, _lat, _lon, _r, limit = 20) {
			const needle = name.toLowerCase();
			return Object.values(data.elements)
				.filter((e) => (e.tags.name ?? '').toLowerCase().includes(needle))
				.slice(0, limit);
		}
	};
}

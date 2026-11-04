// The shared OSM store (osm.json): add / refresh / local edits, plus around and name search. Written only via lib/osm-store-file.
import { existsSync, readFileSync } from 'node:fs';
import { parseStore, readStore, writeStore, WholeFloat, type Store, type StoreEntry } from '../lib/osm-store-file';
import { compactPlaceName } from '../../../src/lib/hikes/place-links';
import { ApiError } from './errors';
import { versionOf } from './doc';
import { withDocLock } from './doc-lock';
import { repoPaths } from './paths';
import { createTerrain } from './terrain';
import type { OsmClient, RawElement } from './osm-client';

const LOCK = '@osm';
const REF_RE = /^(node|way|relation)\/(\d+)$/;
const SHORT_RE = /^([nwr])(\d+)$/i;
const URL_RE = /^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/(\d+)(?:[/?#].*)?$/;
const SHORT_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation' };
const VISITED = ['yes', 'no', 'missing'];
const KIND_KEYS = ['natural', 'tourism', 'amenity', 'place', 'mountain_pass', 'highway', 'railway', 'waterway', 'man_made', 'leisure', 'historic', 'shop', 'building', 'route', 'landuse', 'boundary'];

/** Thrown when `base` is not the current store version; the route answers 409 with the current version. */
export class StaleStoreError extends ApiError {
	constructor(public version: string) {
		super(409, 'osm.json changed on disk');
	}
}

export type Deps = { client: OsmClient; today?: () => string };
export type Entry = StoreEntry;
export type TagDiff = { added: Record<string, string>; removed: Record<string, string>; changed: Record<string, { from: string; to: string }> };

export function parseRef(text: string): string {
	const s = String(text ?? '').trim();
	for (const re of [REF_RE, URL_RE]) {
		const m = re.exec(s);
		if (m) return `${m[1]}/${Number(m[2])}`;
	}
	const m = SHORT_RE.exec(s);
	if (m) return `${SHORT_TYPES[m[1].toLowerCase()]}/${Number(m[2])}`;
	throw new ApiError(400, `Not an OSM element: ${JSON.stringify(text)} (expected e.g. node/123 or an openstreetmap.org link)`);
}

export function storeVersion(root: string): string {
	const file = repoPaths(root).osmStore;
	return versionOf(existsSync(file) ? readFileSync(file) : '');
}

function loadStore(root: string): Store {
	const file = repoPaths(root).osmStore;
	return existsSync(file) ? readStore(file) : {};
}

/** One store entry with the store version, both from a single file read (so they always match). */
export function storeEntry(root: string, ref: string): { version: string; entry: Entry } {
	const r = parseRef(ref);
	const file = repoPaths(root).osmStore;
	const text = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
	const entry = text.length ? parseStore(text.toString('utf-8'))[r] : undefined;
	if (!entry) throw new ApiError(404, `${r} is not in the store`);
	return { version: versionOf(text), entry };
}

function guarded<T>(root: string, base: string, fn: (store: Store) => Promise<T> | T): Promise<T> {
	if (typeof base !== 'string' || !base) throw new ApiError(400, 'base (the store version) is required');
	return withDocLock(LOCK, async () => {
		const version = storeVersion(root);
		if (version !== base) throw new StaleStoreError(version);
		return fn(loadStore(root));
	});
}

const today = () => new Date().toISOString().slice(0, 10);

/** Python prints whole floats with ".0" (demEle 1577.0). */
const num = (v: number): number => (Number.isInteger(v) ? (new WholeFloat(v) as unknown as number) : v);

function entryFrom(root: string, el: RawElement, date: string): Entry {
	const point = el.type === 'node' ? el : el.center;
	if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number') throw new ApiError(502, `OSM gave no position for ${el.type}/${el.id}`);
	const entry: Entry = { lat: num(point.lat), lon: num(point.lon) };
	let h: number | null = null;
	try {
		h = createTerrain(repoPaths(root).demDir).height(point.lat, point.lon);
	} catch {
		/* a corrupt DEM tile must not block adding the element: store it without demEle */
	}
	if (h !== null) entry.demEle = num(h);
	entry.tags = { ...el.tags };
	entry.fetched = date;
	return entry;
}

function merge(old: Entry | undefined, fresh: Entry): Entry {
	return old?.local && Object.keys(old.local).length ? { ...fresh, local: old.local } : fresh;
}

async function fetchOne(deps: Deps, refs: string[]): Promise<Record<string, RawElement>> {
	const found = await deps.client.elements(refs);
	for (const r of refs) if (!found[r]) throw new ApiError(404, `OSM has no ${r} (deleted, or a typo?)`);
	return found;
}

export async function addToStore(root: string, refs: string[], base: string, deps: Deps) {
	if (!Array.isArray(refs) || !refs.length) throw new ApiError(400, 'refs must be a non-empty list');
	const typed = [...new Set(refs.map(parseRef))];
	if (typeof base !== 'string' || !base) throw new ApiError(400, 'base (the store version) is required');
	const found = await fetchOne(deps, typed); // network before the lock, so local saves aren't blocked
	return guarded(root, base, async (store) => {
		const date = (deps.today ?? today)();
		const entries: Record<string, Entry> = {};
		for (const r of typed) {
			store[r] = merge(store[r], entryFrom(root, found[r], date));
			entries[r] = store[r];
		}
		writeStore(repoPaths(root).osmStore, store);
		return { version: storeVersion(root), entries };
	});
}

function diffTags(a: Record<string, string>, b: Record<string, string>): TagDiff {
	const d: TagDiff = { added: {}, removed: {}, changed: {} };
	for (const [k, v] of Object.entries(b)) {
		if (!(k in a)) d.added[k] = v;
		else if (a[k] !== v) d.changed[k] = { from: a[k], to: v };
	}
	for (const [k, v] of Object.entries(a)) if (!(k in b)) d.removed[k] = v;
	return d;
}

export async function refreshElement(root: string, ref: string, base: string, deps: Deps) {
	const r = parseRef(ref);
	if (typeof base !== 'string' || !base) throw new ApiError(400, 'base (the store version) is required');
	const found = await fetchOne(deps, [r]);
	return guarded(root, base, async (store) => {
		const old = store[r];
		if (!old) throw new ApiError(404, `${r} is not in the store`);
		const entry = merge(old, entryFrom(root, found[r], (deps.today ?? today)()));
		store[r] = entry;
		writeStore(repoPaths(root).osmStore, store);
		const redundantLocal = Object.entries(old.local ?? {})
			.filter(([k, v]) => (v === null ? !(k in entry.tags) : entry.tags[k] === v))
			.map(([k]) => k);
		return { version: storeVersion(root), entry, diff: diffTags(old.tags ?? {}, entry.tags), redundantLocal };
	});
}

export async function setLocal(root: string, ref: string, local: unknown, base: string) {
	const r = parseRef(ref);
	if (!local || typeof local !== 'object' || Array.isArray(local)) throw new ApiError(400, 'local must be an object');
	const next = local as Record<string, unknown>;
	for (const [k, v] of Object.entries(next)) {
		if (v !== null && typeof v !== 'string') throw new ApiError(400, `local.${k} must be a string or null`);
		if (k === 'visited' && v !== null && !VISITED.includes(v as string)) throw new ApiError(400, 'visited must be yes, no or missing');
	}
	return guarded(root, base, (store) => {
		const entry = store[r];
		if (!entry) throw new ApiError(404, `${r} is not in the store`);
		const { local: _old, ...rest } = entry;
		store[r] = Object.keys(next).length ? { ...rest, local: next } : rest;
		writeStore(repoPaths(root).osmStore, store);
		return { version: storeVersion(root), entry: store[r] };
	});
}

// ---- lookups for the picker ----

export type OsmItem = { ref: string; name: string | null; kind: string | null; lat: number; lon: number; inStore: boolean };

export function mainKind(tags: Record<string, string>): string | null {
	for (const k of KIND_KEYS) if (tags[k]) return `${k}=${tags[k]}`;
	const other = Object.keys(tags).find((k) => !k.startsWith('name') && k !== 'source' && k !== 'ele');
	return other ? `${other}=${tags[other]}` : null;
}

export function effectiveTags(entry: Entry): Record<string, string> {
	const merged: Record<string, string | null> = { ...(entry.tags ?? {}), ...(entry.local ?? {}) };
	return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null)) as Record<string, string>;
}

function point(el: RawElement): { lat: number; lon: number } | null {
	const p = el.type === 'node' ? el : el.center;
	return p && typeof p.lat === 'number' && typeof p.lon === 'number' ? { lat: p.lat, lon: p.lon } : null;
}

function itemOf(el: RawElement, inStore: Set<string>): OsmItem | null {
	const p = point(el);
	if (!p) return null;
	const ref = `${el.type}/${el.id}`;
	return { ref, name: el.tags.name ?? null, kind: mainKind(el.tags), ...p, inStore: inStore.has(ref) };
}

const ORDER = { node: 0, way: 1, relation: 2 };

export async function osmAround(root: string, lat: number, lon: number, r: number, client: OsmClient): Promise<OsmItem[]> {
	const radius = Math.min(200, Math.max(5, r));
	const known = new Set(Object.keys(loadStore(root)));
	const cos = Math.cos((lat * Math.PI) / 180);
	const dist = (i: OsmItem) => Math.hypot((i.lat - lat) * 111320, (i.lon - lon) * 111320 * cos);
	const els = (await client.around(lat, lon, radius)).filter((el) => Object.keys(el.tags ?? {}).length > 0);
	const items = (list: RawElement[]) =>
		list
			.map((el) => itemOf(el, known))
			.filter((i): i is OsmItem => !!i)
			.sort((a, b) => ORDER[a.ref.split('/')[0] as keyof typeof ORDER] - ORDER[b.ref.split('/')[0] as keyof typeof ORDER] || dist(a) - dist(b));
	// The features near the point first; the areas it is inside (a lake, a park, a village) after them.
	return [...items(els.filter((e) => !e.enclosing)), ...items(els.filter((e) => e.enclosing))];
}

const METRES_PER_DEGREE = 111194.9266;

/** Metres from `p` to the nearest point of the line (`[lon, lat]` pairs), equirectangular around `p`. */
export function distanceToLine(p: { lat: number; lon: number }, line: [number, number][]): number {
	const cos = Math.cos((p.lat * Math.PI) / 180);
	const xy = ([lon, lat]: [number, number]) => [(lon - p.lon) * METRES_PER_DEGREE * cos, (lat - p.lat) * METRES_PER_DEGREE];
	let best = Infinity;
	for (let i = 0; i < line.length; i++) {
		const [ax, ay] = xy(line[i]);
		const [bx, by] = i + 1 < line.length ? xy(line[i + 1]) : [ax, ay];
		const dx = bx - ax, dy = by - ay;
		const len = dx * dx + dy * dy;
		// The segment's point nearest the origin (`p`).
		const t = len ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
		best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
	}
	return best;
}

/** The point halfway along the line, by length. */
export function lineMidpoint(line: [number, number][]): { lat: number; lon: number } {
	const seg = line.slice(1).map(([lon, lat], i) => distanceToLine({ lat, lon }, [line[i]]));
	let rest = seg.reduce((a, b) => a + b, 0) / 2;
	const round = (v: number) => Math.round(v * 1e7) / 1e7;
	for (let i = 0; i < seg.length; i++) {
		if (rest <= seg[i] && seg[i] > 0) {
			const t = rest / seg[i];
			const [a, b] = [line[i], line[i + 1]];
			return { lat: round(a[1] + t * (b[1] - a[1])), lon: round(a[0] + t * (b[0] - a[0])) };
		}
		rest -= seg[i];
	}
	const last = line[line.length - 1];
	return { lat: last[1], lon: last[0] };
}

/**
 * Store names, then OSM's by name around `lat`/`lon`. With the hike's `route`, OSM is searched around its midpoint and
 * both lists are sorted by distance from the route.
 */
/** `source`: 'store' searches only osm.json (no network), 'osm' only OpenStreetMap (Overpass, or the OSM API for a pasted id), 'all' both. */
export type SearchSource = 'all' | 'store' | 'osm';

export async function osmSearch(root: string, q: string, lat: number | null, lon: number | null, client: OsmClient, route: [number, number][] | null = null, source: SearchSource = 'all') {
	if (route?.length) ({ lat, lon } = lineMidpoint(route));
	const byRoute = (items: OsmItem[]) => (route?.length ? items.map((i) => [i, distanceToLine(i, route)] as const).sort((a, b) => a[1] - b[1]).map(([i]) => i) : items);
	const store = loadStore(root);
	const known = new Set(Object.keys(store));
	const text = q.trim();
	let ref: string | null = null;
	try {
		ref = parseRef(text);
	} catch {
		ref = null;
	}
	if (ref) {
		const el = store[ref];
		if (el) return { store: [storeItem(ref, el)], osm: [] as OsmItem[] };
		if (source === 'store') return { store: [] as OsmItem[], osm: [] as OsmItem[] };
		const found = (await client.elements([ref]))[ref];
		const item = found ? itemOf(found, known) : null;
		if (!item) throw new ApiError(404, `OSM has no ${ref} (deleted, or a typo?)`);
		return { store: [], osm: [item], ref };
	}
	const out: { store: OsmItem[]; osm: OsmItem[]; osm_error?: string } = { store: [], osm: [] };
	const needle = compactPlaceName(text);
	if (!needle) return out;
	if (source !== 'osm') {
		for (const [r, entry] of Object.entries(store)) {
			const tags = effectiveTags(entry);
			if (Object.entries(tags).some(([k, v]) => k.startsWith('name') && compactPlaceName(v).includes(needle))) out.store.push(storeItem(r, entry));
		}
	}
	if (source !== 'store' && lat !== null && lon !== null) {
		try {
			const seen = new Set(out.store.map((i) => i.ref));
			for (const el of await client.searchName(text, lat, lon)) {
				const item = itemOf(el, known);
				if (item && !seen.has(item.ref)) out.osm.push(item);
			}
		} catch (e) {
			out.osm_error = e instanceof Error ? e.message : String(e); // the store results still help
		}
	}
	return { ...out, store: byRoute(out.store), osm: byRoute(out.osm) };
}

function storeItem(ref: string, entry: Entry): OsmItem {
	const tags = effectiveTags(entry);
	return { ref, name: tags.name ?? null, kind: mainKind(tags), lat: entry.lat, lon: entry.lon, inStore: true };
}

/** Store elements inside a bounding box (snapping candidates for the map tools), capped. */
export function storeInBox(root: string, box: { south: number; west: number; north: number; east: number }, cap = 500) {
	const items: { ref: string; name: string | null; lat: number; lon: number }[] = [];
	for (const [ref, e] of Object.entries(loadStore(root))) {
		if (typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
		if (e.lat < box.south || e.lat > box.north || e.lon < box.west || e.lon > box.east) continue;
		items.push({ ref, name: effectiveTags(e).name ?? null, lat: e.lat, lon: e.lon });
		if (items.length >= cap) break;
	}
	return items;
}

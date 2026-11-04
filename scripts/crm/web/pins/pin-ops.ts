// Pure helpers of the pin editor: pin list edits (clamped to the photo, 4 decimals), pointer → photo fractions on a
// letterboxed image, distance/bearing labels for the picker, and adding a picked OSM element to the store.
import { containedBox } from '$lib/hikes/photo-pins';
import { avifTiers, avifVariantHref } from '$lib/renderers/responsive-image';
import { ApiClientError, api } from '../api';

export type Pin = { ref: string; x: number; y: number };
export type LatLon = { lat: number; lon: number };
/** A picker result, as /api/osm/search answers (server/osm-service.ts OsmItem). */
export type PlaceItem = { ref: string; name: string | null; kind: string | null; lat: number; lon: number; inStore: boolean };
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/**
 * The editor's image: the largest AVIF tier up to `max` px (1280; zoomed in, more) that the photo has (tiers exist only
 * where they fit), the href itself when it is too small for any; with the size unknown, the `max` tier (the img falls
 * back to the href on error).
 */
export function pinImageSrc(href: string, w: number | undefined, h: number | undefined, max = 1280): string {
	if (!w || !h) return avifVariantHref(href, max);
	const tier = avifTiers(w, h)
		.filter((t) => t.target <= max)
		.pop();
	return tier ? avifVariantHref(href, tier.target) : href;
}

/** One arrow press moves a pin this fraction of the photo; Shift moves it five times as far. */
export const NUDGE = 0.002;
export const SHIFT_STEPS = 5;

const fit = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
const at = (pins: Pin[], i: number, f: (p: Pin) => Pin | null): Pin[] => {
	if (!Number.isInteger(i) || i < 0 || i >= pins.length) return pins;
	const next = f(pins[i]);
	return next ? pins.map((p, j) => (j === i ? next : p)) : pins.filter((_, j) => j !== i);
};

/** Each op returns a new list; x/y are clamped to [0, 1] and rounded to 4 decimals. */
export const pinOps = {
	add: (pins: Pin[], ref: string, x: number, y: number): Pin[] => [...pins, { ref, x: fit(x), y: fit(y) }],
	move: (pins: Pin[], i: number, x: number, y: number): Pin[] => at(pins, i, (p) => ({ ...p, x: fit(x), y: fit(y) })),
	remove: (pins: Pin[], i: number): Pin[] => at(pins, i, () => null),
	/** `dx`/`dy` in arrow presses (Shift: pass ±SHIFT_STEPS). */
	nudge: (pins: Pin[], i: number, dx: number, dy: number): Pin[] => at(pins, i, (p) => ({ ...p, x: fit(p.x + dx * NUDGE), y: fit(p.y + dy * NUDGE) }))
};

/**
 * What Esc does in the pin editor: cancel a new pin first; in the caption field with unsaved text, only leave the field
 * (the draft stays, a second Esc closes); otherwise close.
 */
export function escapeAction(s: { pending: boolean; inCaption: boolean; captionDirty: boolean }): 'cancel-pin' | 'blur' | 'close' {
	if (s.pending) return 'cancel-pin';
	if (s.inCaption && s.captionDirty) return 'blur';
	return 'close';
}

/**
 * Zoom and pan of the photo stage: its content is drawn `translate(x, y) scale(z)` (origin top left, px of the stage).
 * z = 1 with x = y = 0 is the whole photo.
 */
export type View = { z: number; x: number; y: number };
export const NO_ZOOM: View = { z: 1, x: 0, y: 0 };
export const MAX_ZOOM = 8;
type Rect = { left: number; top: number; width: number; height: number };

/**
 * Keeps the photo filling the stage along each axis it is larger than the stage in (no panning past its edge), and
 * centred along an axis it is smaller in. `drawn` is the photo's contained box at z = 1.
 */
export function clampView(v: View, box: { width: number; height: number }, drawn: Rect): View {
	const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
	if (z === 1) return NO_ZOOM;
	const axis = (t: number, size: number, start: number, len: number) => {
		const lo = size - (start + len) * z; // the photo's far edge at the stage's far edge
		const hi = -start * z; // the photo's near edge at the stage's near edge
		return (len * z <= size ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, t))) + 0; // + 0: no -0
	};
	return { z, x: axis(v.x, box.width, drawn.left, drawn.width), y: axis(v.y, box.height, drawn.top, drawn.height) };
}

/** Zooms by `factor` keeping the stage point (`px`, `py`) (px from the stage's top left) over the same spot of the photo. */
export function zoomAt(v: View, factor: number, px: number, py: number, box: { width: number; height: number }, drawn: Rect): View {
	const z = Math.min(MAX_ZOOM, Math.max(1, v.z * factor));
	const k = z / v.z;
	return clampView({ z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, box, drawn);
}

/**
 * The photo fraction under a pointer at (`clientX`, `clientY`) over an `object-fit: contain` image of `imgW`×`imgH`
 * drawn in `box` (its bounding rect), zoomed and panned by `view`. Off the photo (on the bars): null, or clamped to its
 * edge when `clamp`.
 */
export function pointerFraction(clientX: number, clientY: number, box: Rect, imgW: number, imgH: number, clamp = false, view: View = NO_ZOOM): { x: number; y: number } | null {
	const d = containedBox(box.width, box.height, imgW, imgH);
	if (!d.width || !d.height) return null;
	const x = ((clientX - box.left - view.x) / view.z - d.left) / d.width;
	const y = ((clientY - box.top - view.y) / view.z - d.top) / d.height;
	if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
	return { x: fit(x), y: fit(y) };
}

const RAD = Math.PI / 180;
const R = 6371008.8;

export function distanceM(a: LatLon, b: LatLon): number {
	const dLat = (b.lat - a.lat) * RAD;
	const dLon = (b.lon - a.lon) * RAD;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass point (16) of the initial bearing from `a` to `b`. */
export function bearing16(a: LatLon, b: LatLon): string {
	const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
	const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
	const deg = (Math.atan2(y, x) / RAD + 360) % 360;
	return POINTS[Math.round(deg / 22.5) % 16];
}

/** "7.1 km · SSW", "350 m · N"; empty without a reference point. */
export function distanceLabel(from: LatLon | null, to: LatLon): string {
	if (!from) return '';
	const m = distanceM(from, to);
	const d = m < 1000 ? `${Math.round(m)} m` : m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
	return `${d} · ${bearing16(from, to)}`;
}

/**
 * Picker order: by distance from the photo. Without a photo position the hike's own nodes come first, then the rest,
 * both by distance from the hike's origin (labels from there too). Without either, the order is kept.
 */
export function rankPlaces<T extends PlaceItem>(items: T[], photo: LatLon | null, origin: LatLon | null, hikeRefs: string[]): (T & { label: string })[] {
	const from = photo ?? origin;
	const own = new Set(photo ? [] : hikeRefs);
	const dist = (p: T) => (from ? distanceM(from, p) : 0);
	return items
		.map((p, i) => ({ p, i, own: own.has(p.ref) ? 0 : 1, d: dist(p) }))
		.sort((a, b) => a.own - b.own || a.d - b.d || a.i - b.i)
		.map(({ p }) => ({ ...p, label: distanceLabel(from, p) }));
}

type SearchAnswer = { store: PlaceItem[]; osm: PlaceItem[]; osm_error?: string };

/** Searches osm.json: no network, so it runs while typing. */
export async function searchStore(text: string, request: Request = api): Promise<PlaceItem[]> {
	const params = new URLSearchParams({ q: text, source: 'store' });
	return (await request<SearchAnswer>('GET', `/api/osm/search?${params}`)).store;
}

/**
 * Asks OpenStreetMap for `text` near `near` and adds what it finds to the `listed` places. Only on request: it can take
 * a minute when Overpass is busy. A failure keeps `listed` and says why in `osmError`.
 */
export async function searchOsm(text: string, near: LatLon | null, listed: PlaceItem[], request: Request = api): Promise<{ items: PlaceItem[]; osmError: string | null }> {
	const params = new URLSearchParams({ q: text, source: 'osm' });
	if (near) (params.set('lat', String(near.lat)), params.set('lon', String(near.lon)));
	try {
		const r = await request<SearchAnswer>('GET', `/api/osm/search?${params}`);
		// OSM's answer can repeat a place that is already listed.
		const seen = new Set(listed.map((i) => i.ref));
		const more = [...r.store, ...r.osm].filter((i) => !seen.has(i.ref) && seen.add(i.ref));
		return { items: [...listed, ...more], osmError: r.osm_error ?? null };
	} catch (e) {
		return { items: listed, osmError: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * One write at a time, in call order: pin and caption writes share it, so each is sent with the base the previous one
 * returned. A failed write rejects its own promise only; later ones still run.
 */
export function serialRunner(): <T>(fn: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const next = tail.then(fn, fn);
		tail = next.catch(() => {});
		return next;
	};
}

/** Adds a picked element to osm.json unless it is there already; a stale store version is refetched and retried once. */
export async function ensureInStore(item: Pick<PlaceItem, 'ref' | 'inStore'>, request: Request = api): Promise<void> {
	if (item.inStore) return;
	for (let attempt = 0; ; attempt++) {
		const { version } = await request<{ version: string }>('GET', '/api/osm/store/version');
		try {
			await request('POST', '/api/osm/add', { refs: [item.ref], base: version });
			return;
		} catch (e) {
			if (attempt === 0 && e instanceof ApiClientError && e.status === 409) continue;
			throw e;
		}
	}
}

// A place field's value: what a pick writes (a store or OSM element, a tap on the map, a km), a spot's name around its
// place, a point's name, and any written form in words. The site's validator (facts.server.ts readRawPlace) reads all
// of them. No fetch client here: form-model reads labels from this module.
import type { AuthoredPlace } from '$lib/hikes/facts-library.server';
import type { Place } from '$lib/hikes/facts-schema';
import { KM_RE } from '$lib/hikes/facts-spec';

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** What the picker gave: an element (in the store by now), a named tap on the route's map, or a distance. */
export type PlacePick =
	| { kind: 'element'; ref: string }
	| { kind: 'tap'; lat: number; lon: number; name: string; demEle?: number | null }
	| { kind: 'km'; km: number };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
const english = (v: unknown): string => (typeof v === 'string' ? v : isObject(v) && typeof v.en === 'string' ? v.en : '');

/** The place as written: `{ref}`, `{lat, lon, name?, demEle?}` (7 decimals, the name English only) or `{km}`. */
export function placeValue(pick: PlacePick): AuthoredPlace {
	if (pick.kind === 'element') return { ref: pick.ref };
	if (pick.kind === 'km') return { km: pick.km };
	const name = pick.name.trim();
	return { lat: round7(pick.lat), lon: round7(pick.lon), ...(name ? { name: { en: name } } : {}), ...(pick.demEle != null ? { demEle: pick.demEle } : {}) };
}

/** A tap with the terrain height there (null off the DEM tiles: then the place has none). */
export async function tapPick(lat: number, lon: number, name: string, request: Request): Promise<PlacePick> {
	const { demEle } = await request<{ demEle: number | null }>('GET', `/api/terrain/height?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`);
	return { kind: 'tap', lat, lon, name, demEle };
}

/**
 * A spot written as a name, with or without a place (`{name, at?}`): the validator's own test (facts.server.ts, `spot`).
 * It takes `{ref, name}` too, which the site then refuses as a spot (unknown key `ref`; Problems shows it); placing
 * such a spot writes `{name, at}`, which repairs it.
 */
export function isNamedSpot(v: unknown): v is { name: unknown; at?: unknown } {
	return isObject(v) && 'name' in v && !('lat' in v);
}

/** A spot written as a plain string that isn't a km: the site reads it as "may just be a name", so it is the spot's name. */
const nameString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !KM_RE.test(v.trim());

/** A spot's name as written: a named spot's `name`, or a plain name string; undefined when the spot is only a place. */
export function spotNameOf(value: unknown): unknown {
	return isNamedSpot(value) ? value.name : nameString(value) ? value : undefined;
}

/** A spot given a place: a named spot (or a plain name string) keeps its name with the place as `at`; otherwise the place is the spot. */
export function spotPlace(current: unknown, place: AuthoredPlace): unknown {
	return isNamedSpot(current) || nameString(current) ? { name: spotNameOf(current), at: place } : place;
}

/**
 * A spot's name set (a text as written) or cleared (undefined): a named spot keeps its `at`, a plain name string is
 * replaced, and a placed one (a km string or an object place) gets the name with its place as `at`. Cleared, the place
 * stays (or nothing, undefined).
 */
export function spotName(current: unknown, name: unknown): unknown {
	if (name === undefined) return isNamedSpot(current) ? (current.at ?? undefined) : undefined;
	if (isNamedSpot(current)) return { ...current, name };
	return current == null || current === '' || nameString(current) ? { name } : { name, at: current };
}

const isPoint = (v: unknown): v is Record<string, unknown> => isObject(v) && typeof v.lat === 'number' && typeof v.lon === 'number';

/**
 * The name of the point the value is: a text as written, undefined unnamed; null when the value is no point. A named
 * spot's `at` has none to edit: the site shows the spot's name there.
 */
export function pointName(value: unknown): unknown {
	return isPoint(value) ? value.name : null;
}

/** The point with its name set (a text as written) or, undefined, removed: the point stays, unnamed. Any other value as it is. */
export function withPointName(value: unknown, name: unknown): unknown {
	if (!isPoint(value)) return value;
	const { name: _old, ...rest } = value;
	return name === undefined ? rest : { ...value, name };
}

/** Any written place, spot or GPX path in words; `resolved` (the site's reading) names an element written as a ref. */
export function placeLabel(value: unknown, resolved?: Place): string {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (!isObject(value)) return JSON.stringify(value);
	// A place's `{ref, name?}` before a named spot: a spot written so is refused by the site, but shows as the place.
	if (typeof value.ref === 'string') {
		const name = english(value.name) || (resolved?.ref === value.ref ? resolved.name.en : '');
		return name ? `${name} (${value.ref})` : value.ref;
	}
	if (isNamedSpot(value)) {
		const name = english(value.name);
		return value.at == null ? name : `${name} (${placeLabel(value.at, resolved)})`;
	}
	// The old `{node}` form, which the validator now refuses.
	if (value.node != null) return String(value.node);
	if (value.km != null) return `km ${value.km}`;
	if (value.lat != null && value.lon != null) {
		const name = english(value.name);
		return name ? `${name} (${value.lat}, ${value.lon})` : `${value.lat}, ${value.lon}`;
	}
	return JSON.stringify(value);
}

/** `placeLabel` with a ref (the value's or a named spot's `at`) named by `names` (the store's names). */
export function namedLabel(value: unknown, names?: (ref: string) => string | undefined): string {
	const v = isObject(value) ? value : {};
	const ref = typeof v.ref === 'string' ? v.ref : isObject(v.at) && typeof v.at.ref === 'string' ? v.at.ref : null;
	const name = ref && names ? names(ref) : undefined;
	return placeLabel(value, ref && name ? { name: { en: name }, ref, resolved: true } : undefined);
}

/** The bailout GPX files a `gpx` field can name: the served paths of the doc's files state. */
export function bailoutFiles(files: unknown): string[] {
	const list = isObject(files) ? files.bailouts : undefined;
	return Array.isArray(list) ? list.map((b) => (isObject(b) ? b.route : undefined)).filter((r): r is string => typeof r === 'string') : [];
}

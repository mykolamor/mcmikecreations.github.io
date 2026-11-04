/**
 * The facts schema, described once: what the validator and the merge in
 * `facts.server.ts` read, and what the CRM's Facts tab walks to draw its forms.
 *
 * Browser-safe: no Node and no `.server` imports.
 */

import { ENUMS, LEVEL4, SNOWSHOE_GRADES, type EnumGroup, type Place, type Text } from './facts-schema';
import { normalizePlaceName } from './place-links';

/** A place written as a distance along the route: `km 7.5` (or `km 7,5`). */
export const KM_RE = /^km\s*(\d+(?:[.,]\d+)?)$/i;

export const LIBRARY_KINDS = ['stops', 'transport', 'lifts', 'parking', 'tickets'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** A record id other than a stop's, which is its OSM ref: `rb60-munich-ehrwald`. */
export const LIBRARY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type Spec =
	/** `ref: 'post'`: a post's name, `<date>-<slug>` (the CRM offers a search over the posts; read as any string). */
	| { t: 'str'; ref?: 'post' }
	| { t: 'num'; min?: number; max?: number; int?: boolean }
	| { t: 'bool' }
	| { t: 'date' }
	| { t: 'time' }
	| { t: 'month' }
	| { t: 'enum'; of: readonly (string | number)[]; labelled?: boolean; group?: EnumGroup }
	| { t: 'sac' }
	/** An ISO 3166-1 alpha-2 country code, `DE`. */
	| { t: 'country' }
	| { t: 'text' }
	/** A Place: a node name, `km 7.5`, `{node}`, `{km}` or `{lat, lon}`. Warns when unresolved. */
	| { t: 'place' }
	/** A Place, or a named spot that needn't be a node: `{name, at?}`, or a string that may just be a name. */
	| { t: 'spot' }
	| { t: 'link' }
	/** A served path to a GPX file (`/_projects/…/x.gpx`); read and summarised after the merge. */
	| { t: 'gpx' }
	| { t: 'window' }
	| { t: 'open' }
	/**
	 * `id`: identity fields for merging, first alternative with any field present wins. Without one, the post's list replaces.
	 * `key`: an entry's identity when it takes more than fields, in place of `id`'s.
	 * `lib`: the library kind its entries start from (`use`, or a stop's place).
	 */
	| { t: 'list'; of: Spec; id?: string[][]; key?: (entry: Record<string, unknown>, record?: Record<string, unknown>) => string; lib?: LibraryKind }
	| { t: 'obj'; f: Record<string, Spec>; req?: string[] };

const str: Spec = { t: 'str' };
const post: Spec = { t: 'str', ref: 'post' };
const num: Spec = { t: 'num' };
const nonNeg: Spec = { t: 'num', min: 0 };
const int0: Spec = { t: 'num', min: 0, int: true };
const bool: Spec = { t: 'bool' };
const date: Spec = { t: 'date' };
const time: Spec = { t: 'time' };
const text: Spec = { t: 'text' };
const place: Spec = { t: 'place' };
/** A text's and a place's spec, for code that walks values by spec outside the schema. */
export { text as TEXT, place as PLACE };
const spot: Spec = { t: 'spot' };
const link: Spec = { t: 'link' };
const sac: Spec = { t: 'sac' };
const months: Spec = { t: 'list', of: { t: 'month' } };
const texts: Spec = { t: 'list', of: text };
const e = (group: EnumGroup, labelled = false): Spec => ({ t: 'enum', of: ENUMS[group], group, labelled });
const list = (of: Spec, ...id: string[][]): Spec => ({ t: 'list', of, ...(id.length ? { id } : {}) });
const obj = (f: Record<string, Spec>, req: string[] = []): Spec => ({ t: 'obj', f, req });

const span = { from: place, to: place };
const price: Spec = list(obj({ amount: nonNeg, currency: str, per: e('pricePer'), note: text, checked: date }, ['amount']));
const window: Spec = { t: 'window' };
const ferrataGrade = { grade: str, scale: e('ferrataScale') };
const climbGrade = { grade: str, scale: e('climbScale') };
const SPAN_ID = ['from', 'to'];

/**
 * A route list entry's merge identity, in two spaces that never meet: a table
 * entry (`inTable`, the default; on the profile too or not) by its `to`, as
 * the old legs; a profile-only entry by its span, as the old sections. So a
 * section from the start to X stays clear of the leg to X.
 */
function legKey(leg: Record<string, unknown>, record?: Record<string, unknown>): string {
	return (leg.inTable ?? true) ? `table|${identity(leg, [['to']], record)}` : `profile|${identity(leg, [SPAN_ID], record)}`;
}

// The entries a library record can stand in for. `use` names the record; a stop finds its own by place.
const stopEntry = obj({
	at: place, kind: e('stop'), open: { t: 'open' }, days: text, overnight: bool, booking: link,
	phone: str, water: bool, food: bool, cash: bool, price, note: text, checked: date
}, ['at']);
const transportEntry = obj({
	use: str, mode: e('transport'), from: text, to: spot, direction: e('direction'), duration: nonNeg,
	changes: int0, line: str, operator: str, first: time, last: time, frequency: text,
	price, ticket: text, url: link, note: text, checked: date
}, ['mode', 'from', 'to']);
const parkingEntry = obj({
	use: str, at: place, name: text, price, size: e('parkingSize'), fills: e('parkingFills'),
	freeWith: text, url: link, note: text, checked: date
});
const liftEntry = obj({
	use: str, name: text, kind: e('lift'), ...span, direction: e('liftDirection'), open: window,
	first: time, last: time, price, url: link, note: text, checked: date
}, ['name']);
const ticketEntry = obj({ use: str, name: text, includes: texts, price, validity: text, url: link, note: text, checked: date }, ['name']);

const libList = (lib: LibraryKind, of: Spec, ...id: string[][]): Spec => ({ t: 'list', of, id, lib });

/** An entry's spec without some of its fields: a library record is one with neither `use` nor, for a stop, its place. */
function without(spec: Spec, ...keys: string[]): Extract<Spec, { t: 'obj' }> {
	const { f, req = [] } = spec as Extract<Spec, { t: 'obj' }>;
	return obj(Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k))), req.filter((k) => !keys.includes(k))) as Extract<Spec, { t: 'obj' }>;
}

export const RECORDS: Record<LibraryKind, Extract<Spec, { t: 'obj' }>> = {
	stops: without(stopEntry, 'at'),
	// A transport record may hold all of a connection or only part of it; the entry using it needs the whole.
	transport: { ...without(transportEntry, 'use'), req: [] },
	lifts: without(liftEntry, 'use'),
	parking: without(parkingEntry, 'use'),
	tickets: without(ticketEntry, 'use')
};

export const FACTS: Extract<Spec, { t: 'obj' }> = obj({
	checked: date,
	summary: text,
	difficulty: obj({
		sac,
		note: text,
		viaFerrata: list(
			obj({ ...ferrataGrade, ...span, name: text, length: nonNeg, gain: nonNeg, time: nonNeg, note: text }, ['grade']),
			['name'], SPAN_ID
		),
		climbing: obj({ ...climbGrade, note: text }, ['grade']),
		exposure: obj({ level: { t: 'enum', of: LEVEL4 }, note: text }, ['level']),
		fitness: { t: 'enum', of: [1, 2, 3, 4, 5] },
		winter: obj({
			snowshoe: { t: 'enum', of: SNOWSHOE_GRADES },
			skiTour: str,
			avalanche: { t: 'enum', of: [1, 2, 3, 4, 5] },
			note: text
		})
	}),
	season: obj({ best: months, possible: months, window, note: text }),
	route: obj({
		start: spot,
		end: spot,
		type: e('routeType'),
		official: text,
		optional: list(obj({ ...span, name: text, note: text }), ['name'], SPAN_ID),
		terrain: list(e('terrain')),
		shade: e('level4'),
		trails: list(str),
		peaks: list(place),
		regions: list(e('region')),
		categories: list(e('category')),
		countries: list({ t: 'country' }),
		huts: list(place)
	}),
	navigation: obj({
		marking: e('marking'),
		spans: list(obj({ ...span, marking: e('marking'), note: text }, ['marking']), SPAN_ID),
		note: text,
		offline: bool
	}),
	hazards: list(
		obj({ ...span, kind: e('hazard', true), label: text, at: place, severity: e('severity'), season: months, note: text }, ['kind']),
		['kind', 'at', 'from', 'to']
	),
	bailouts: list(
		obj({ at: place, to: text, via: e('bailoutVia'), time: nonNeg, note: text, last: bool, route: { t: 'gpx' } }, ['at']),
		['at']
	),
	water: list(
		obj({ at: place, kind: e('water'), reliable: e('reliability'), treat: bool, note: text }, ['at']),
		['at']
	),
	signal: list(obj({ ...span, quality: e('signal'), network: str, note: text }, ['quality']), SPAN_ID),
	stops: libList('stops', stopEntry, ['at']),
	access: obj({
		carFree: e('carFree'),
		transport: libList('transport', transportEntry, ['mode', 'from', 'to']),
		parking: libList('parking', parkingEntry, ['name'], ['at']),
		lifts: libList('lifts', liftEntry, ['name']),
		tickets: libList('tickets', ticketEntry, ['name']),
		borders: list(obj({ at: place, from: str, to: str, note: text }, ['at', 'from', 'to']), ['at']),
		note: text,
		checked: date
	}),
	permits: list(
		obj({ name: text, required: bool, where: text, price, url: link, note: text, checked: date }, ['name']),
		['name']
	),
	drones: text,
	protectedAreas: text,
	rules: list(obj({ ...span, kind: e('rule', true), label: text, season: months, note: text }, ['kind']), ['kind', 'from', 'to']),
	suitability: obj({
		kids: e('kids'), dogs: e('dogs'), stroller: bool, bike: e('bike'), winter: e('winter'),
		night: e('experienced'), solo: e('experienced'), note: text
	}),
	// The route list: rows of the leg table and bands on the profile (`checkLegs`), merged by `legKey`.
	legs: {
		t: 'list',
		of: obj({
			from: place, to: place, sac, viaFerrata: obj(ferrataGrade, ['grade']), climbing: obj(climbGrade, ['grade']),
			terrain: list(e('terrain')), marking: e('marking'), optional: bool, note: text, inTable: bool, onProfile: bool
		}),
		id: [SPAN_ID],
		key: legKey
	},
	conditions: obj({
		weather: list(e('weather')),
		temp: obj({ min: num, max: num }),
		visibility: e('visibility'),
		snowLine: nonNeg,
		traction: e('traction'),
		trail: list(e('trail')),
		crowding: e('crowding'),
		start: time,
		why: text,
		note: text
	}),
	deviations: list(obj({ kind: e('deviation'), at: place, note: text }, ['note']), ['kind', 'at']),
	plan: obj({
		gear: list(
			obj({ item: e('gear', true), label: text, need: e('gearNeed'), when: text, amount: text }, ['item']),
			['item', 'label']
		),
		for: texts,
		notFor: texts,
		variants: list(
			obj({
				name: text, summary: text, distance: nonNeg, ascent: nonNeg, descent: nonNeg, duration: nonNeg,
				sac, viaFerrata: obj(ferrataGrade, ['grade']), link: post, recommended: bool, note: text
			}, ['name']),
			['name']
		),
		timing: obj({
			start: time,
			turnaround: time,
			sunrise: obj({ start: time, note: text }, ['start']),
			note: text
		}),
		alternatives: obj({ easier: list(post), harder: list(post), similar: list(post) }),
		note: text
	}),
	sources: list(
		obj({ title: text, url: str, kind: e('source'), lang: str, note: text }, ['title', 'url']),
		['url']
	)
}) as Extract<Spec, { t: 'obj' }>;

function placeKey(p: Place): string {
	if (p.ref != null) return `ref:${p.ref}`;
	if (p.lat != null && p.lon != null) return `ll:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
	return `name:${normalizePlaceName(p.name.en)}`;
}

function valueKey(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'object' && 'resolved' in (v as object)) return placeKey(v as Place);
	if (typeof v === 'object' && 'en' in (v as object)) return `text:${normalizePlaceName((v as Text).en)}`;
	return `v:${String(v)}`;
}

/** An entry's merge identity: the first of `id`'s alternatives with any field present. An entry that starts from a library record is the record with its own fields on top. */
export function identity(entry: Record<string, unknown>, id: string[][], record?: Record<string, unknown>): string {
	const merged = record ? { ...record, ...entry } : entry;
	const alt = id.find((fields) => fields.some((f) => merged[f] != null)) ?? id[0];
	return alt.map((f) => `${f}=${valueKey(merged[f])}`).join('|');
}

/** A list entry's identity in the merge: the list's `key`, else its `id` fields. */
export function entryKey(list: Extract<Spec, { t: 'list' }>, entry: Record<string, unknown>, record?: Record<string, unknown>): string {
	return list.key ? list.key(entry, record) : identity(entry, list.id!, record);
}

/** The spec at a path under `root` (`facts`, or a library record); a number steps into a list's entries. */
export function specAt(path: (string | number)[], root: Spec = FACTS): Spec | undefined {
	let spec: Spec | undefined = root;
	for (const step of path) {
		if (spec?.t === 'obj' && typeof step === 'string') spec = spec.f[step];
		else if (spec?.t === 'list' && typeof step === 'number') spec = spec.of;
		else return undefined;
	}
	return spec;
}

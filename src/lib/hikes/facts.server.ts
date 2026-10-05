/**
 * Reads a hike's hand-written facts: the sidecar's `facts` (route defaults)
 * and the post's front-matter `facts`, each validated, every place resolved
 * against the hike's nodes and projected onto the route, then the post
 * deep-merged on top of the sidecar.
 *
 * Malformed data throws, naming the source file and the key path: a typo in a
 * hand-typed hazard should fail the build, not silently drop the hazard. A
 * place that matches nothing only warns (it still renders, as plain text).
 *
 * The rules live in docs/superpowers/specs/2026-10-04-hike-facts-schema-design.md.
 * One schema description (`FACTS`) drives validation and merging alike, so the
 * two can't disagree about what a field is.
 *
 * Relative imports only, so it runs under plain Node for tests.
 */

import {
	ENUMS, LEVEL4, SNOWSHOE_GRADES, isSacGrade, sacRank,
	type BailoutRoute, type HikeAuthoredFacts, type Place, type Text
} from './facts-schema';
import { davDuration } from './hike-facts';
import { buildPlaceIndex, nodeEle, normalizePlaceName, type PlaceIndex } from './place-links';
import { routeLocator } from './photo-stops';
import { cumulativeKm, haversineKm, pointAtKm, routeCoords } from './hike-metrics';
import schemaKeys from './schema-keys.json';

// ---------------------------------------------------------------------------
// Schema description

type Spec =
	| { t: 'str' }
	| { t: 'num'; min?: number; max?: number; int?: boolean }
	| { t: 'bool' }
	| { t: 'date' }
	| { t: 'time' }
	| { t: 'month' }
	| { t: 'enum'; of: readonly (string | number)[]; labelled?: boolean }
	| { t: 'sac' }
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
	/** `id`: identity fields for merging, first alternative with any field present wins. Without one, the post's list replaces. */
	| { t: 'list'; of: Spec; id?: string[][] }
	| { t: 'obj'; f: Record<string, Spec>; req?: string[] };

const str: Spec = { t: 'str' };
const num: Spec = { t: 'num' };
const nonNeg: Spec = { t: 'num', min: 0 };
const int0: Spec = { t: 'num', min: 0, int: true };
const bool: Spec = { t: 'bool' };
const date: Spec = { t: 'date' };
const time: Spec = { t: 'time' };
const text: Spec = { t: 'text' };
const place: Spec = { t: 'place' };
const spot: Spec = { t: 'spot' };
const link: Spec = { t: 'link' };
const sac: Spec = { t: 'sac' };
const months: Spec = { t: 'list', of: { t: 'month' } };
const texts: Spec = { t: 'list', of: text };
const e = (group: keyof typeof ENUMS, labelled = false): Spec => ({ t: 'enum', of: ENUMS[group], labelled });
const list = (of: Spec, ...id: string[][]): Spec => ({ t: 'list', of, ...(id.length ? { id } : {}) });
const obj = (f: Record<string, Spec>, req: string[] = []): Spec => ({ t: 'obj', f, req });

const span = { from: place, to: place };
const price: Spec = list(obj({ amount: nonNeg, currency: str, per: e('pricePer'), note: text, checked: date }, ['amount']));
const window: Spec = { t: 'window' };
const ferrataGrade = { grade: str, scale: e('ferrataScale') };
const climbGrade = { grade: str, scale: e('climbScale') };
const SPAN_ID = ['from', 'to'];

const FACTS = obj({
	checked: date,
	summary: text,
	difficulty: obj({
		sac,
		note: text,
		sections: list(
			obj({ ...span, sac, viaFerrata: obj(ferrataGrade, ['grade']), climbing: obj(climbGrade, ['grade']), note: text }),
			SPAN_ID
		),
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
		peaks: list(place)
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
	stops: list(
		obj({
			at: place, kind: e('stop'), open: { t: 'open' }, days: text, overnight: bool, booking: link,
			phone: str, water: bool, food: bool, cash: bool, price, note: text, checked: date
		}, ['at']),
		['at']
	),
	access: obj({
		carFree: e('carFree'),
		transport: list(
			obj({
				mode: e('transport'), from: text, to: spot, direction: e('direction'), duration: nonNeg,
				changes: int0, line: str, operator: str, first: time, last: time, frequency: text,
				price, ticket: text, url: link, note: text, checked: date
			}, ['mode', 'from', 'to']),
			['mode', 'from', 'to']
		),
		parking: list(
			obj({
				at: place, name: text, price, size: e('parkingSize'), fills: e('parkingFills'),
				freeWith: text, url: link, note: text, checked: date
			}),
			['name'], ['at']
		),
		lifts: list(
			obj({
				name: text, kind: e('lift'), ...span, direction: e('liftDirection'), open: window,
				first: time, last: time, price, url: link, note: text, checked: date
			}, ['name']),
			['name']
		),
		tickets: list(
			obj({ name: text, includes: texts, price, validity: text, url: link, note: text, checked: date }, ['name']),
			['name']
		),
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
	legs: list(
		obj({
			to: place, terrain: list(e('terrain')), sac, viaFerrata: obj(ferrataGrade, ['grade']),
			marking: e('marking'), optional: bool, note: text
		}, ['to']),
		['to']
	),
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
				sac, viaFerrata: obj(ferrataGrade, ['grade']), link: str, recommended: bool, note: text
			}, ['name']),
			['name']
		),
		timing: obj({
			start: time,
			turnaround: time,
			sunrise: obj({ start: time, note: text }, ['start']),
			note: text
		}),
		alternatives: obj({ easier: list(str), harder: list(str), similar: list(str) }),
		note: text
	}),
	sources: list(
		obj({ title: text, url: str, kind: e('source'), lang: str, note: text }, ['title', 'url']),
		['url']
	)
});

/** Keys that describe a single day, so only a post may set them. */
const POST_ONLY = new Set(['conditions', 'deviations']);

// ---------------------------------------------------------------------------
// Validation and place resolution

/** A post's `null`: removes the sidecar's value for that key. */
const DELETE = Symbol('delete');

interface Ctx {
	source: string;
	/** Post mode: `null` means DELETE and `remove: true` entries are kept for the merge. */
	post: boolean;
	warnings: string[];
	resolve: (raw: RawPlace, path: string, warn: boolean) => Place;
}

type RawPlace =
	| { kind: 'name'; name: string }
	| { kind: 'node'; node: number; name?: Text }
	| { kind: 'km'; km: number }
	| { kind: 'll'; lat: number; lon: number; name?: Text; ele?: number; demEle?: number };

class FactsError extends Error {}

function fail(ctx: Ctx, path: string, problem: string): never {
	throw new FactsError(`Hike facts in ${ctx.source}: ${path}: ${problem}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function readText(ctx: Ctx, v: unknown, path: string): Text {
	if (typeof v === 'string' || typeof v === 'number') {
		const s = String(v).trim();
		if (!s) fail(ctx, path, 'empty text');
		return { en: s };
	}
	if (isObj(v)) {
		for (const k of Object.keys(v)) if (k !== 'en' && k !== 'de') fail(ctx, path, `unknown language "${k}" (en, de)`);
		// A post may carry only a translation of the sidecar's text; `clean` checks the merged result has `en`.
		if (!(ctx.post && v.en == null) && (typeof v.en !== 'string' || !v.en.trim())) {
			fail(ctx, path, 'text needs a non-empty `en`');
		}
		const out = (typeof v.en === 'string' ? { en: v.en.trim() } : {}) as Text;
		if (v.de != null) {
			if (typeof v.de !== 'string' || !v.de.trim()) fail(ctx, `${path}.de`, 'expected text');
			out.de = v.de.trim();
		}
		return out;
	}
	fail(ctx, path, 'expected text: a string or { en, de }');
}

const KM_RE = /^km\s*(\d+(?:[.,]\d+)?)$/i;

function readRawPlace(ctx: Ctx, v: unknown, path: string): RawPlace {
	if (typeof v === 'string' && v.trim()) {
		const km = KM_RE.exec(v.trim());
		return km ? { kind: 'km', km: parseFloat(km[1].replace(',', '.')) } : { kind: 'name', name: v.trim() };
	}
	if (isObj(v)) {
		const keys = Object.keys(v).sort().join(',');
		if (keys === 'node' || keys === 'name,node') {
			if (!Number.isInteger(v.node)) fail(ctx, `${path}.node`, 'expected an OSM node id');
			// A name for a node OSM leaves unnamed (a fore-summit cross), or to call it something else.
			return { kind: 'node', node: v.node as number, ...(v.name != null ? { name: readText(ctx, v.name, `${path}.name`) } : {}) };
		}
		if (keys === 'km') {
			if (typeof v.km !== 'number' || v.km < 0) fail(ctx, `${path}.km`, 'expected a distance in km');
			return { kind: 'km', km: v.km };
		}
		if (typeof v.lat === 'number' && typeof v.lon === 'number') {
			// `demEle`: the 3D map's terrain height there, written by scripts/backfill_terrain.py (sidecar) or by hand.
			for (const k of Object.keys(v)) if (!schemaKeys.factsPlaceKeys.includes(k)) fail(ctx, path, `unknown key "${k}"`);
			if (Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) fail(ctx, path, 'coordinates out of range');
			const out: RawPlace = { kind: 'll', lat: v.lat, lon: v.lon };
			if (v.name != null) out.name = readText(ctx, v.name, `${path}.name`);
			if (v.ele != null) {
				if (typeof v.ele !== 'number') fail(ctx, `${path}.ele`, 'expected metres');
				out.ele = v.ele;
			}
			if (v.demEle != null) {
				if (typeof v.demEle !== 'number') fail(ctx, `${path}.demEle`, 'expected metres');
				out.demEle = v.demEle;
			}
			return out;
		}
	}
	fail(ctx, path, 'expected a place: a node name, "km 7.5", { node, name? }, { km } or { lat, lon, name?, ele?, demEle? }');
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function readWindowEnd(ctx: Ctx, v: unknown, path: string): string {
	if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12) return pad2(v);
	if (typeof v === 'string' && /^(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(v)) return v;
	fail(ctx, path, 'expected "MM" or "MM-DD"');
}

function validate(ctx: Ctx, spec: Spec, v: unknown, path: string): unknown {
	if (v === null || v === undefined) return ctx.post && v === null ? DELETE : undefined;
	switch (spec.t) {
		case 'str':
			if (typeof v === 'number') return String(v);
			if (typeof v !== 'string' || !v.trim()) fail(ctx, path, 'expected a string');
			return v.trim();
		case 'num':
			if (typeof v !== 'number' || !Number.isFinite(v)) fail(ctx, path, 'expected a number');
			if (spec.int && !Number.isInteger(v)) fail(ctx, path, 'expected a whole number');
			if (spec.min != null && v < spec.min) fail(ctx, path, `expected at least ${spec.min}`);
			if (spec.max != null && v > spec.max) fail(ctx, path, `expected at most ${spec.max}`);
			return v;
		case 'bool':
			if (typeof v !== 'boolean') fail(ctx, path, 'expected true or false');
			return v;
		case 'date':
			// js-yaml turns an unquoted 2026-07-19 into a Date.
			if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
			if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
			fail(ctx, path, 'expected a date, YYYY-MM-DD');
		case 'time':
			if (typeof v === 'number') fail(ctx, path, 'expected a time; quote it ("20:30"), unquoted YAML reads it as a number');
			if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(ctx, path, 'expected a time, "HH:MM"');
			return v;
		case 'month':
			if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 12) fail(ctx, path, 'expected a month, 1–12');
			return v;
		case 'enum':
			if (!spec.of.includes(v as string | number)) {
				// A free-text `label` beside it stands in for a value the enum lacks; checked by the object.
				if (spec.labelled && typeof v === 'string' && v.trim()) return v.trim();
				fail(ctx, path, `unknown value "${String(v)}" (expected one of: ${spec.of.join(', ')})`);
			}
			return v;
		case 'sac':
			if (typeof v !== 'string' || !isSacGrade(v)) fail(ctx, path, 'expected an SAC grade, T1–T6 with an optional + or -');
			return v;
		case 'text':
			return readText(ctx, v, path);
		case 'place':
			return ctx.resolve(readRawPlace(ctx, v, path), path, true);
		case 'spot': {
			// A named trailhead or town that needn't be a node: no warning when a bare name matches nothing.
			if (isObj(v) && 'name' in v && !('lat' in v)) {
				for (const k of Object.keys(v)) if (k !== 'name' && k !== 'at') fail(ctx, path, `unknown key "${k}"`);
				const name = readText(ctx, v.name, `${path}.name`);
				if (v.at == null) return { name, resolved: true } satisfies Place;
				return { ...ctx.resolve(readRawPlace(ctx, v.at, `${path}.at`), `${path}.at`, true), name };
			}
			const raw = readRawPlace(ctx, v, path);
			return ctx.resolve(raw, path, raw.kind !== 'name');
		}
		case 'gpx':
			if (typeof v !== 'string' || !/^\/.+\.gpx$/i.test(v.trim()) || v.includes('..')) fail(ctx, path, 'expected a served GPX path, "/_projects/…/route.gpx"');
			return v.trim();
		case 'link':
			if (typeof v === 'string' && v.trim()) return { url: v.trim() };
			if (isObj(v) && typeof v.url === 'string') {
				for (const k of Object.keys(v)) if (k !== 'url' && k !== 'label') fail(ctx, path, `unknown key "${k}"`);
				return { url: v.url, ...(v.label != null ? { label: readText(ctx, v.label, `${path}.label`) } : {}) };
			}
			fail(ctx, path, 'expected a URL or { url, label }');
		case 'window':
			if (!isObj(v)) fail(ctx, path, 'expected { from, to }');
			for (const k of Object.keys(v)) if (k !== 'from' && k !== 'to') fail(ctx, path, `unknown key "${k}"`);
			return { from: readWindowEnd(ctx, v.from, `${path}.from`), to: readWindowEnd(ctx, v.to, `${path}.to`) };
		case 'open':
			if (v === 'all-year' || v === 'closed') return v;
			return validate(ctx, { t: 'window' }, v, path);
		case 'list': {
			if (!Array.isArray(v)) fail(ctx, path, 'expected a list');
			const records = spec.of.t === 'obj' && spec.id;
			return v.map((item, i) => {
				const p = `${path}[${i}]`;
				if (records && isObj(item) && item.remove === true) {
					const { remove: _, ...rest } = item;
					if (!ctx.post) {
						ctx.warnings.push(`Hike facts in ${ctx.source}: ${p}: \`remove\` only means something in a post; entry dropped`);
						return undefined;
					}
					return { ...(validateObj(ctx, spec.of as Extract<Spec, { t: 'obj' }>, rest, p, false) as object), remove: true };
				}
				const out = validate(ctx, spec.of, item, p);
				if (out === undefined || out === DELETE) fail(ctx, p, 'empty list entry');
				return out;
			}).filter((x) => x !== undefined);
		}
		case 'obj':
			return validateObj(ctx, spec, v, path, true);
	}
}

function validateObj(ctx: Ctx, spec: Extract<Spec, { t: 'obj' }>, v: unknown, path: string, checkRequired: boolean): unknown {
	if (!isObj(v)) fail(ctx, path, 'expected a mapping');
	const out: Record<string | symbol, unknown> = {};
	for (const [k, raw] of Object.entries(v)) {
		const sub = spec.f[k];
		if (!sub) fail(ctx, path, `unknown key "${k}" (expected one of: ${Object.keys(spec.f).join(', ')})`);
		const val = validate(ctx, sub, raw, path ? `${path}.${k}` : k);
		if (val !== undefined) out[k] = val;
	}
	// An enum value the enum lacks is only fine with a `label` to show instead.
	for (const [k, sub] of Object.entries(spec.f)) {
		if (sub.t === 'enum' && sub.labelled && typeof out[k] === 'string' && !sub.of.includes(out[k] as string) && !out.label) {
			fail(ctx, `${path}.${k}`, `unknown value "${out[k]}" (expected one of: ${sub.of.join(', ')}, or add a \`label\`)`);
		}
	}
	if (checkRequired) {
		for (const k of spec.req ?? []) {
			if (out[k] === undefined || out[k] === DELETE) fail(ctx, path ? `${path}.${k}` : k, 'required');
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Merging

function placeKey(p: Place): string {
	if (p.node != null) return `node:${p.node}`;
	if (p.lat != null && p.lon != null) return `ll:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
	return `name:${normalizePlaceName(p.name.en)}`;
}

function valueKey(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'object' && 'resolved' in (v as object)) return placeKey(v as Place);
	if (typeof v === 'object' && 'en' in (v as object)) return `text:${normalizePlaceName((v as Text).en)}`;
	return `v:${String(v)}`;
}

function identity(entry: Record<string, unknown>, id: string[][]): string {
	const alt = id.find((fields) => fields.some((f) => entry[f] != null)) ?? id[0];
	return alt.map((f) => `${f}=${valueKey(entry[f])}`).join('|');
}

function merge(ctx: Ctx, spec: Spec, base: unknown, over: unknown, path: string): unknown {
	if (over === undefined) return base;
	if (over === DELETE) return undefined;
	if (spec.t === 'text' && base && over) return { ...(base as Text), ...(over as Text) };
	if (spec.t === 'obj') {
		const b = (base ?? {}) as Record<string, unknown>;
		const o = over as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const k of new Set([...Object.keys(b), ...Object.keys(o)])) {
			const val = merge(ctx, spec.f[k], b[k], o[k], path ? `${path}.${k}` : k);
			if (val !== undefined) out[k] = val;
		}
		return out;
	}
	if (spec.t === 'list' && spec.id && spec.of.t === 'obj') {
		const out = ((base ?? []) as Record<string, unknown>[]).map((x) => ({ ...x }));
		const keys = out.map((x) => identity(x, spec.id!));
		for (const entry of over as Record<string, unknown>[]) {
			const key = identity(entry, spec.id);
			const at = keys.indexOf(key);
			if (entry.remove) {
				if (at === -1) {
					ctx.warnings.push(`Hike facts in ${ctx.source}: ${path}: \`remove\` matched no sidecar entry (${key})`);
				} else {
					out.splice(at, 1);
					keys.splice(at, 1);
				}
				continue;
			}
			if (at === -1) {
				out.push(entry);
				keys.push(key);
			} else {
				out[at] = merge(ctx, spec.of, out[at], entry, `${path}[${at}]`) as Record<string, unknown>;
			}
		}
		return out;
	}
	return over;
}

/** Drops `remove` entries a post adds without a sidecar underneath, and DELETE markers. */
function clean(ctx: Ctx, spec: Spec, v: unknown, path: string): unknown {
	if (v === DELETE) return undefined;
	if (spec.t === 'text' && !(v as Text).en) fail(ctx, path, 'text has a translation but no `en`, here or in the sidecar');
	if (spec.t === 'obj' && isObj(v)) {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			const c = clean(ctx, spec.f[k], val, path ? `${path}.${k}` : k);
			if (c !== undefined) out[k] = c;
		}
		return out;
	}
	if (spec.t === 'list' && Array.isArray(v)) {
		return v.flatMap((item, i) => {
			if (isObj(item) && item.remove) {
				ctx.warnings.push(`Hike facts in ${ctx.source}: ${path}[${i}]: \`remove\` matched no sidecar entry`);
				return [];
			}
			return [clean(ctx, spec.of, item, `${path}[${i}]`)];
		});
	}
	return v;
}

// ---------------------------------------------------------------------------
// Entry point

export interface FactsNode {
	id?: number;
	lat: number;
	lon: number;
	/** 3D map terrain height, from scripts/backfill_terrain.py. */
	demEle?: number;
	tags?: Record<string, unknown> | null;
}

export interface ReadFactsInput {
	/** The post's front-matter `facts`. */
	post: unknown;
	/** The sidecar's `facts`. */
	sidecar: unknown;
	/** File names for messages. */
	postSource: string;
	sidecarSource: string;
	nodes: FactsNode[] | null | undefined;
	/** The route GeoJSON's coordinates and the chart's distance stretch, for km/altitude. */
	coords: number[][] | null | undefined;
	distanceFactor: number;
	/** The text of a served GPX file (bailout routes), or null when there's no such file. */
	readGpx?: (servedPath: string) => string | null;
}

export interface ReadFactsResult {
	facts: HikeAuthoredFacts | null;
	warnings: string[];
}

function makeResolver(input: ReadFactsInput, warnings: string[]) {
	const nodes = (input.nodes ?? []).filter((n) => typeof n?.lat === 'number' && typeof n?.lon === 'number');
	const index: PlaceIndex | null = buildPlaceIndex(nodes);
	const locate = routeLocator(input.coords, input.distanceFactor);
	const route = routeCoords(input.coords);
	const cum = cumulativeKm(route, input.distanceFactor);
	const total = cum.at(-1) ?? 0;

	const fromNode = (node: FactsNode, fallbackName: string, ownName?: Text): Place => {
		const at = locate(node.lat, node.lon);
		const ele = nodeEle(node) ?? at?.ele;
		const name = typeof node.tags?.name === 'string' && node.tags.name ? node.tags.name : fallbackName;
		return {
			name: ownName ?? { en: name },
			...(node.id != null ? { node: node.id } : {}),
			lat: node.lat,
			lon: node.lon,
			...(at ? { km: at.km } : {}),
			...(ele != null ? { ele: Math.round(ele) } : {}),
			...(typeof node.demEle === 'number' ? { demEle: node.demEle } : {}),
			resolved: true
		};
	};

	return (raw: RawPlace, path: string, warn: boolean, source: string): Place => {
		const unresolved = (name: string, why: string): Place => {
			if (warn) warnings.push(`Hike facts in ${source}: ${path}: place "${name}" ${why}; shown as plain text`);
			return { name: { en: name }, resolved: !warn };
		};
		switch (raw.kind) {
			case 'name': {
				const hit = index?.match(normalizePlaceName(raw.name).split(' '), NaN);
				if (hit && hit.start === 0) return fromNode(hit.node as FactsNode, raw.name);
				return unresolved(raw.name, 'matches none of the hike\'s nodes');
			}
			case 'node': {
				const node = nodes.find((n) => n.id === raw.node);
				return node ? fromNode(node, String(raw.node), raw.name) : unresolved(raw.name?.en ?? `node ${raw.node}`, 'is not one of the hike\'s nodes');
			}
			case 'km': {
				if (route.length < 2 || raw.km > total + 1e-9) {
					return unresolved(`km ${raw.km}`, `is beyond the route's ${total.toFixed(1)} km`);
				}
				const { lat, lon, ele } = pointAtKm(route, cum, raw.km);
				return {
					name: { en: `km ${raw.km}` },
					lat,
					lon,
					km: raw.km,
					...(ele != null ? { ele: Math.round(ele) } : {}),
					resolved: true
				};
			}
			case 'll': {
				const at = locate(raw.lat, raw.lon);
				const ele = raw.ele ?? at?.ele;
				return {
					name: raw.name ?? { en: `${raw.lat.toFixed(5)}, ${raw.lon.toFixed(5)}` },
					lat: raw.lat,
					lon: raw.lon,
					...(at ? { km: at.km } : {}),
					...(ele != null ? { ele: Math.round(ele) } : {}),
					...(raw.demEle != null ? { demEle: raw.demEle } : {}),
					resolved: true
				};
			}
		}
	};
}

/** Track or route points of a GPX file, in order: `trkpt`s, or `rtept`s when there are none. */
export function parseGpxPoints(gpx: string): { lat: number; lon: number; ele?: number }[] {
	const read = (tag: string) => {
		const out: { lat: number; lon: number; ele?: number }[] = [];
		const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g');
		for (const m of gpx.matchAll(re)) {
			const lat = parseFloat(/\blat="([^"]+)"/.exec(m[1])?.[1] ?? '');
			const lon = parseFloat(/\blon="([^"]+)"/.exec(m[1])?.[1] ?? '');
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
			const ele = parseFloat(/<ele>\s*([^<\s]+)\s*<\/ele>/.exec(m[2] ?? '')?.[1] ?? '');
			out.push({ lat, lon, ...(Number.isFinite(ele) ? { ele } : {}) });
		}
		return out;
	};
	const trk = read('trkpt');
	return trk.length ? trk : read('rtept');
}

/** Elevation changes smaller than this, from the last counted point, are noise. */
const GPX_ELE_STEP_M = 2;

/** A bailout's planned GPX route, reduced to what the page draws and shows. */
export function summariseGpxRoute(url: string, gpx: string): BailoutRoute | null {
	const pts = parseGpxPoints(gpx).filter(
		(p, i, all) => i === 0 || p.lat !== all[i - 1].lat || p.lon !== all[i - 1].lon
	);
	if (pts.length < 2) return null;
	let distance = 0;
	for (let i = 1; i < pts.length; i++) distance += haversineKm([pts[i - 1].lon, pts[i - 1].lat], [pts[i].lon, pts[i].lat]) * 1000;
	const route: BailoutRoute = {
		url,
		coords: pts.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]),
		distance: Math.round(distance)
	};
	const eles = pts.map((p) => p.ele).filter((e): e is number => e != null);
	if (eles.length === pts.length) {
		let ascent = 0;
		let descent = 0;
		let last = eles[0];
		for (const e of eles) {
			if (e - last >= GPX_ELE_STEP_M) { ascent += e - last; last = e; }
			else if (last - e >= GPX_ELE_STEP_M) { descent += last - e; last = e; }
		}
		route.ascent = Math.round(ascent);
		route.descent = Math.round(descent);
		route.duration = Math.round(davDuration(distance, ascent, descent));
	}
	return route;
}

function byKm<T extends { at: Place }>(items: T[] | undefined): T[] | undefined {
	if (!items) return items;
	return [...items].sort((a, b) => (a.at.km ?? Infinity) - (b.at.km ?? Infinity));
}

/** The hardest SAC grade among the sections and the non-optional legs, or undefined. */
export function computedSac(facts: HikeAuthoredFacts): string | undefined {
	const grades = [
		...(facts.difficulty?.sections ?? []).map((s) => s.sac),
		...(facts.legs ?? []).filter((l) => !l.optional).map((l) => l.sac)
	].filter((g): g is string => typeof g === 'string');
	return grades.reduce<string | undefined>((a, b) => (a == null || sacRank(b) > sacRank(a) ? b : a), undefined);
}

/**
 * The hike's facts, or null when neither the sidecar nor the post has any.
 * Throws on malformed data; returns warnings for unresolved places and stray
 * `remove`s (the caller logs them).
 */
export function readHikeFacts(input: ReadFactsInput): ReadFactsResult {
	const warnings: string[] = [];

	// `hidden: true` in a post switches the whole facts layer off, sidecar
	// included, without reading any of it.
	let postFacts = input.post;
	if (isObj(postFacts) && 'hidden' in postFacts) {
		const { hidden, ...rest } = postFacts;
		if (typeof hidden !== 'boolean') {
			throw new FactsError(`Hike facts in ${input.postSource}: hidden: expected true or false`);
		}
		if (hidden) return { facts: null, warnings };
		postFacts = Object.keys(rest).length ? rest : undefined;
	}

	const resolver = makeResolver(input, warnings);
	const ctxFor = (source: string, post: boolean): Ctx => ({
		source, post, warnings,
		resolve: (raw, path, warn) => resolver(raw, path, warn, source)
	});

	const sideCtx = ctxFor(input.sidecarSource, false);
	let side: Record<string, unknown> | undefined;
	if (input.sidecar != null) {
		side = validate(sideCtx, FACTS, input.sidecar, '') as Record<string, unknown>;
		for (const k of POST_ONLY) {
			if (k in side) {
				warnings.push(`Hike facts in ${input.sidecarSource}: ${k}: describes a single day, so only a post may set it; ignored`);
				delete side[k];
			}
		}
	}

	const postCtx = ctxFor(input.postSource, true);
	const post = postFacts != null ? validate(postCtx, FACTS, postFacts, '') : undefined;
	if (side === undefined && post === undefined) return { facts: null, warnings };

	const merged = clean(postCtx, FACTS, merge(postCtx, FACTS, side, post, ''), '') as HikeAuthoredFacts | undefined;
	if (!merged || Object.keys(merged).length === 0) return { facts: null, warnings };

	// A stop on one of the hike's nodes takes its contact details from OSM when the facts give none.
	for (const stop of merged.stops ?? []) {
		const tags = (input.nodes ?? []).find((n) => n.id != null && n.id === stop.at.node)?.tags;
		if (!tags) continue;
		const phone = tags.phone ?? tags['contact:phone'];
		const website = tags.website ?? tags['contact:website'];
		if (!stop.phone && typeof phone === 'string') stop.phone = phone;
		if (!stop.booking && typeof website === 'string') stop.booking = { url: website };
	}

	// Bailout routes: read and summarise each GPX file. A missing file fails like any other typo.
	for (const [i, b] of (merged.bailouts ?? []).entries()) {
		const url = (b as { route?: unknown }).route;
		if (typeof url !== 'string') continue;
		const text = input.readGpx?.(url) ?? null;
		if (text == null) throw new FactsError(`Hike facts: bailouts[${i}].route: no GPX file at "${url}"`);
		const route = summariseGpxRoute(url, text);
		if (!route) throw new FactsError(`Hike facts: bailouts[${i}].route: "${url}" has fewer than two track or route points`);
		b.route = route;
	}

	merged.bailouts = byKm(merged.bailouts);
	merged.water = byKm(merged.water);
	if (!merged.bailouts) delete merged.bailouts;
	if (!merged.water) delete merged.water;

	const computed = computedSac(merged);
	if (merged.difficulty?.sac) {
		merged.difficulty.sacSource = 'manual';
		if (computed && sacRank(computed) > sacRank(merged.difficulty.sac)) {
			warnings.push(
				`Hike facts in ${input.postSource}: difficulty.sac: ${merged.difficulty.sac} is easier than the hardest section or leg (${computed})`
			);
		}
	} else if (computed) {
		merged.difficulty = { ...merged.difficulty, sac: computed, sacSource: 'computed' };
	}

	return { facts: merged, warnings };
}

export { FactsError };

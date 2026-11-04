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
	ENUMS, LEVEL4, SNOWSHOE_GRADES, isSacGrade, normaliseSac, sacRank,
	type BailoutRoute, type HikeAuthoredFacts, type Leg, type Place, type Text
} from './facts-schema';
import { FACTS, KM_RE, PLACE, RECORDS, TEXT, entryKey, type LibraryKind, type Spec } from './facts-spec';
import { RECORD_NAMES, type FactsLibrary } from './facts-library.server';
import { LANGS } from '../i18n/languages';
import { webUrl } from './web-url';
import { davDuration } from './hike-facts';
import { buildPlaceIndex, nodeEle, normalizePlaceName, type PlaceIndex } from './place-links';
import { routeLocator, type RoutePass } from './photo-stops';
import { REF_RE } from '$lib/data/osm-store';
import { formatPhones } from '$lib/data/osm-phone';
import { cumulativeKm, haversineKm, pointAtKm, routeCoords } from './hike-metrics';
import schemaKeys from './schema-keys.json';

/** The library file's name in messages. */
const LIBRARY_SOURCE = 'facts-library.json';

/** Keys that describe a single day, so only a post may set them. */
const POST_ONLY = new Set(['conditions', 'deviations']);

// ---------------------------------------------------------------------------
// Validation and place resolution

/** A post's `null`: removes the sidecar's value for that key. */
const DELETE = Symbol('delete');

/**
 * On a validated entry: the library record it starts from, validated and
 * resolved on this hike. The entry keeps only its own fields until
 * `useRecords`, after the sidecar and the post have merged, lays them over it.
 */
const RECORD = Symbol('record');

type Entry = Record<string | symbol, unknown>;

interface Ctx {
	source: string;
	/** Post mode: `null` means DELETE and `remove: true` entries are kept for the merge. */
	post: boolean;
	warnings: string[];
	resolve: (raw: RawPlace, path: string, warn: boolean) => Place;
	/**
	 * A library record, validated on this hike, or undefined when there is none.
	 * `user`: the entry using it, `post.md: stops[0] (stop record "node/1")`, which its messages name first.
	 */
	record: (kind: LibraryKind, id: string, user: string) => Entry | undefined;
}

type RawPlace =
	| { kind: 'name'; name: string }
	| { kind: 'ref'; ref: string; name?: Text }
	| { kind: 'km'; km: number }
	| { kind: 'll'; lat: number; lon: number; name?: Text; ele?: number; demEle?: number };

class FactsError extends Error {}

/** Echoes an unknown code back, which is how `country` spots one. */
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

function fail(ctx: Ctx, path: string, problem: string): never {
	throw new FactsError(`Hike facts in ${ctx.source}: ${path}: ${problem}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function readText(ctx: Ctx, v: unknown, path: string): Text {
	return validateText(v, path, ctx.source, { post: ctx.post });
}

/**
 * One free text: a string, or one key per language in `langs` (`LANGS`; a
 * test passes its own list). `post`: a post may carry only a translation of
 * the sidecar's text, so `en` may be missing; `clean` checks the merged result has it.
 */
export function validateText(
	v: unknown, path: string, source: string,
	{ post = false, langs = LANGS }: { post?: boolean; langs?: readonly string[] } = {}
): Text {
	function failText(at: string, problem: string): never {
		throw new FactsError(`Hike facts in ${source}: ${at}: ${problem}`);
	}
	if (typeof v === 'string' || typeof v === 'number') {
		const s = String(v).trim();
		if (!s) failText(path, 'empty text');
		return { en: s };
	}
	if (isObj(v)) {
		for (const k of Object.keys(v)) if (!langs.includes(k)) failText(path, `unknown language "${k}" (${langs.join(', ')})`);
		if (!(post && v.en == null) && (typeof v.en !== 'string' || !v.en.trim())) {
			failText(path, 'text needs a non-empty `en`');
		}
		const out: Record<string, string> = typeof v.en === 'string' ? { en: v.en.trim() } : {};
		for (const lang of langs) {
			if (lang === 'en' || v[lang] == null) continue;
			const t = v[lang];
			if (typeof t !== 'string' || !t.trim()) failText(`${path}.${lang}`, 'expected text');
			out[lang] = t.trim();
		}
		return out as Text;
	}
	failText(path, `expected text: a string or { ${langs.join(', ')} }`);
}

/**
 * A sidecar with its `name` and `description` checked: each a string, or a
 * text with one key per language (an unknown one fails the build). A plain
 * string is trimmed, as a text's `en` is; a sidecar with nothing to change
 * comes back as is.
 */
export function readSidecarTexts<T extends { name?: unknown; description?: unknown }>(raw: T, source: string): T {
	let out = raw;
	for (const key of ['name', 'description'] as const) {
		const v = raw[key];
		if (v == null) continue;
		if (typeof v === 'string') {
			if (v !== v.trim()) out = { ...out, [key]: v.trim() };
			continue;
		}
		out = { ...out, [key]: validateText(v, key, source) };
	}
	return out;
}

function readRawPlace(ctx: Ctx, v: unknown, path: string): RawPlace {
	if (typeof v === 'string' && v.trim()) {
		const km = KM_RE.exec(v.trim());
		return km ? { kind: 'km', km: parseFloat(km[1].replace(',', '.')) } : { kind: 'name', name: v.trim() };
	}
	if (isObj(v)) {
		const keys = Object.keys(v).sort().join(',');
		if ('node' in v) fail(ctx, `${path}.node`, 'name the element by typed ref instead: {ref: node/123}');
		if (keys === 'ref' || keys === 'name,ref') {
			if (typeof v.ref !== 'string' || !REF_RE.test(v.ref)) fail(ctx, `${path}.ref`, 'expected node/…, way/… or relation/…');
			// A name for an element OSM leaves unnamed (a fore-summit cross), or to call it something else.
			return { kind: 'ref', ref: v.ref as string, ...(v.name != null ? { name: readText(ctx, v.name, `${path}.name`) } : {}) };
		}
		if (keys === 'km') {
			if (typeof v.km !== 'number' || v.km < 0) fail(ctx, `${path}.km`, 'expected a distance in km');
			return { kind: 'km', km: v.km };
		}
		if (typeof v.lat === 'number' && typeof v.lon === 'number') {
			// `demEle`: the 3D map's terrain height there, written by `pnpm crm terrain` (sidecar) or by hand.
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
			if (typeof v !== 'string' || !isSacGrade(v)) {
				fail(ctx, path, 'expected an SAC grade, T1–T6 with an optional + or -, or an easier–harder range like T1-T2');
			}
			return normaliseSac(v);
		case 'country':
			if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v) || REGION_NAMES.of(v) === v) {
				fail(ctx, path, 'expected an ISO 3166-1 alpha-2 country code, like "DE"');
			}
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
					const entry = spec.lib ? withRecord(ctx, spec, rest, p, false) : validateObj(ctx, spec.of as Extract<Spec, { t: 'obj' }>, rest, p, false);
					return { ...(entry as object), remove: true };
				}
				const out = spec.lib && isObj(item) ? withRecord(ctx, spec, item, p, true) : validate(ctx, spec.of, item, p);
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

/**
 * A library kind's entry, with the record it starts from: the one its `use`
 * names (a missing one fails), or for a stop the one keyed by its place's
 * OSM ref. A required field may come from the record.
 */
function withRecord(ctx: Ctx, spec: Extract<Spec, { t: 'list' }>, item: Record<string, unknown>, path: string, checkRequired: boolean): Entry {
	const of = spec.of as Extract<Spec, { t: 'obj' }>;
	const kind = spec.lib!;
	const used = kind !== 'stops' && item.use != null;
	const own = validateObj(ctx, of, item, path, checkRequired && !used) as Entry;
	let record: Entry | undefined;
	if (used) {
		record = ctx.record(kind, own.use as string, `${ctx.source}: ${path} (use "${own.use}")`);
		if (!record) fail(ctx, `${path}.use`, `no ${RECORD_NAMES[kind]} record "${own.use}" in facts-library.json`);
	} else if (kind === 'stops') {
		const ref = (own.at as Place | undefined)?.ref;
		if (ref) record = ctx.record(kind, ref, `${ctx.source}: ${path} (stop record "${ref}")`);
	}
	if (!record) return own;
	if (checkRequired) {
		for (const k of of.req ?? []) {
			if ((own[k] ?? record[k]) === undefined || own[k] === DELETE) fail(ctx, `${path}.${k}`, 'required');
		}
	}
	own[RECORD] = record;
	return own;
}

/**
 * Checks one record of the library file, as `validate` checks an entry; its
 * places are only read, since they are resolved per hike.
 */
export function validateLibraryRecord(kind: LibraryKind, id: string, raw: unknown, source: string): void {
	const ctx: Ctx = {
		source, post: false, warnings: [],
		resolve: () => ({ name: { en: '' }, resolved: true }),
		record: () => undefined
	};
	validateObj(ctx, RECORDS[kind], raw, `${kind}.${id}`, true);
}

/** A library record with its keys in the schema's order, at every depth, for a byte-stable file. */
export function orderLibraryRecord(kind: LibraryKind, record: unknown): unknown {
	return inSchemaOrder(RECORDS[kind], record);
}

function inSchemaOrder(spec: Spec | undefined, v: unknown): unknown {
	if (Array.isArray(v)) return spec?.t === 'list' ? v.map((x) => inSchemaOrder(spec.of, x)) : v;
	if (!isObj(v) || !spec) return v;
	const byKeys = (order: readonly string[], sub: (k: string) => Spec | undefined = () => undefined) => {
		const out: Record<string, unknown> = {};
		for (const k of order) if (k in v) out[k] = inSchemaOrder(sub(k), v[k]);
		for (const [k, val] of Object.entries(v)) if (!(k in out)) out[k] = val;
		return out;
	};
	const named = (k: string) => (k === 'name' ? TEXT : undefined);
	const point = () => ('ref' in v ? byKeys(['ref', 'name'], named) : byKeys(schemaKeys.factsPlaceKeys, named));
	switch (spec.t) {
		case 'obj':
			return byKeys(Object.keys(spec.f), (k) => spec.f[k]);
		case 'text':
			return byKeys(LANGS);
		case 'link':
			return byKeys(['url', 'label'], (k) => (k === 'label' ? TEXT : undefined));
		case 'window':
		case 'open':
			return byKeys(['from', 'to']);
		case 'place':
			return point();
		case 'spot':
			return 'name' in v && !('lat' in v) ? byKeys(['name', 'at'], (k) => (k === 'name' ? TEXT : PLACE)) : point();
		default:
			return v;
	}
}

// ---------------------------------------------------------------------------
// Merging

function merge(ctx: Ctx, spec: Spec, base: unknown, over: unknown, path: string): unknown {
	if (over === undefined) return base;
	if (over === DELETE) return undefined;
	if (spec.t === 'text' && base && over) return { ...(base as Text), ...(over as Text) };
	if (spec.t === 'obj') {
		const b = (base ?? {}) as Record<string, unknown>;
		const o = over as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		// An entry keeps its record: the post's, unless the post drops its `use`.
		const record = o.use === DELETE ? undefined : (o as Entry)[RECORD] ?? (b as Entry)[RECORD];
		for (const k of new Set([...Object.keys(b), ...Object.keys(o)])) {
			const val = merge(ctx, spec.f[k], b[k], o[k], path ? `${path}.${k}` : k);
			if (val !== undefined) out[k] = val;
			// A post's null stays for `useRecords`, to remove the record's value as well.
			else if (record && o[k] === DELETE) out[k] = DELETE;
		}
		if (record) (out as Entry)[RECORD] = record;
		return out;
	}
	if (spec.t === 'list' && spec.id && spec.of.t === 'obj') {
		const out = ((base ?? []) as Record<string, unknown>[]).map((x) => ({ ...x }));
		const idOf = (x: Record<string, unknown>) => entryKey(spec, x, (x as Entry)[RECORD] as Record<string, unknown> | undefined);
		const keys = out.map(idOf);
		for (const entry of over as Record<string, unknown>[]) {
			const key = idOf(entry);
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

/** Lays each entry's own fields (sidecar and post merged) over the library record it starts from. */
function useRecords(ctx: Ctx, spec: Spec, v: unknown, path: string): unknown {
	if (spec.t === 'obj' && isObj(v)) {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) out[k] = useRecords(ctx, spec.f[k], val, path ? `${path}.${k}` : k);
		return out;
	}
	if (spec.t === 'list' && spec.lib && Array.isArray(v)) {
		return (v as Entry[]).map((entry, i) => {
			const record = entry[RECORD];
			if (!record || entry.remove) return entry;
			const { use: _, [RECORD]: __, ...own } = entry;
			return merge(ctx, spec.of, record, own, `${path}[${i}]`);
		});
	}
	return v;
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
	/** Typed OSM id, `node/123`: the key into the OSM store. */
	ref?: string;
	lat: number;
	lon: number;
	/** 3D map terrain height, from `pnpm crm terrain`. */
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
	/**
	 * What a place given by name is matched against: every element of the OSM
	 * store (`storeNodes`). Without it, the hike's own `nodes`.
	 */
	storeNodes?: FactsNode[] | null;
	/** The hike's map centre: of several nodes with one name, the nearest wins. */
	origin?: { lat: number; lon: number } | null;
	/** The hike's map height in px: with `origin`, only store nodes inside the map's tile square match. */
	height?: number | null;
	/** Refs of the hike's own nodes: exempt from the tile-square cutoff. */
	ownRefs?: string[] | null;
	/** The route GeoJSON's coordinates and the chart's distance stretch, for km/altitude. */
	coords: number[][] | null | undefined;
	distanceFactor: number;
	/** The text of a served GPX file (bailout routes), or null when there's no such file. */
	readGpx?: (servedPath: string) => string | null;
	/** The shared facts library (`facts-library.json`), whose records entries `use` and stops attach to. */
	library?: FactsLibrary;
}

export interface ReadFactsResult {
	facts: HikeAuthoredFacts | null;
	warnings: string[];
}

function makeResolver(input: ReadFactsInput, warnings: string[]) {
	const nodes = (input.nodes ?? []).filter((n) => typeof n?.lat === 'number' && typeof n?.lon === 'number');
	const index: PlaceIndex | null = buildPlaceIndex(input.storeNodes ?? nodes, { origin: input.origin, height: input.height, keepRefs: input.ownRefs });
	const locate = routeLocator(input.coords, input.distanceFactor);
	const route = routeCoords(input.coords);
	const cum = cumulativeKm(route, input.distanceFactor);
	const total = cum.at(-1) ?? 0;

	const fromNode = (node: FactsNode, fallbackName: string, ownName?: Text): Place => {
		const passes = locate(node.lat, node.lon);
		const at = passes[0];
		const ele = nodeEle(node) ?? at?.ele;
		const name = typeof node.tags?.name === 'string' && node.tags.name ? node.tags.name : fallbackName;
		return {
			name: ownName ?? { en: name },
			...(node.ref != null ? { ref: node.ref } : {}),
			lat: node.lat,
			lon: node.lon,
			...(at ? { km: at.km } : {}),
			...passesOf(passes),
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
			case 'ref': {
				const node = (input.storeNodes ?? nodes).find((n) => n.ref === raw.ref);
				return node ? fromNode(node, raw.ref, raw.name) : unresolved(raw.name?.en ?? raw.ref, input.storeNodes ? 'is not in the OSM store' : 'is not one of the hike\'s nodes');
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
				const passes = locate(raw.lat, raw.lon);
				const at = passes[0];
				const ele = raw.ele ?? at?.ele;
				return {
					name: raw.name ?? { en: `${raw.lat.toFixed(5)}, ${raw.lon.toFixed(5)}` },
					lat: raw.lat,
					lon: raw.lon,
					...(at ? { km: at.km } : {}),
					...passesOf(passes),
					...(ele != null ? { ele: Math.round(ele) } : {}),
					...(raw.demEle != null ? { demEle: raw.demEle } : {}),
					resolved: true
				};
			}
		}
	};
}

/** A place's `passes`, only when the route passes it more than once. */
function passesOf(passes: RoutePass[]): { passes?: number[] } {
	return passes.length > 1 ? { passes: passes.map((p) => p.km) } : {};
}

function isPlace(v: unknown): v is Place {
	return isObj(v) && typeof v.resolved === 'boolean';
}

/** A place's candidate distances: every pass, else its one km (a `km 7.5` place, or one passed once). */
function kmsOf(p: Place): number[] {
	return p.passes ?? (p.km != null ? [p.km] : []);
}

/**
 * Picks, for each end of every span, the pass that keeps the span in route
 * order: a place the route passes twice (a junction left one way and rejoined
 * another, an out-and-back) otherwise resolves to its first pass, and the span
 * would cover the wrong stretch. The route list's table entries run one after
 * another, so each `to` is its first pass at or after the previous one's; any
 * other span takes the closest pair of passes with `from` before `to`. Ends are
 * copied before their km changes, as places can be shared (a table entry's
 * `from` is the previous one's `to`).
 */
export function orderSpans(facts: HikeAuthoredFacts): void {
	const table = new Set<object>();
	let cursor = 0;
	let prev: Place | undefined;
	for (const leg of facts.legs ?? []) {
		if (!leg.inTable) continue;
		table.add(leg);
		if (prev) leg.from = prev;
		const to = leg.to;
		if (to && to.km != null) {
			const km = kmsOf(to).find((k) => k >= cursor - 1e-9);
			if (km != null && km !== to.km) leg.to = { ...to, km };
			cursor = leg.to!.km!;
		}
		prev = leg.to;
	}

	const visit = (v: unknown): void => {
		if (Array.isArray(v)) return v.forEach(visit);
		if (!isObj(v) || isPlace(v)) return;
		if (!table.has(v) && isPlace(v.from) && isPlace(v.to) && v.from.km != null && v.to.km != null) {
			let best: [number, number] | null = null;
			for (const a of kmsOf(v.from)) {
				const b = kmsOf(v.to).find((k) => k > a);
				if (b != null && (!best || b - a < best[1] - best[0])) best = [a, b];
			}
			if (best) {
				if (best[0] !== v.from.km) v.from = { ...v.from, km: best[0] };
				if (best[1] !== v.to.km) v.to = { ...v.to, km: best[1] };
			}
		}
		Object.values(v).forEach(visit);
	};
	visit(facts);
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

/**
 * The old profile bands, `difficulty.sections`, are entries of `legs` now; an
 * old snippet or file fails with the way over rather than being dropped.
 */
function rejectSections(ctx: Ctx, facts: unknown): void {
	if (isObj(facts) && isObj(facts.difficulty) && 'sections' in facts.difficulty) {
		throw new FactsError(`Hike facts in ${ctx.source}: difficulty.sections moved into legs (inTable: false, onProfile: true); run scripts/crm/oneoff/merge-route-list.ts`);
	}
}

/**
 * The route list's rules: a table entry (`inTable`, the default) needs `to`
 * and starts where the previous one ended, so it has no `from` of its own; an
 * entry off the table is drawn on the profile, or it would show nowhere.
 * `merged` marks a post's list checked after merging with the sidecar's, whose
 * indices are the merged list's.
 */
function checkLegs(ctx: Ctx, legs: unknown, merged = false): void {
	if (!Array.isArray(legs)) return;
	const where = merged ? ' (after merging with the sidecar)' : '';
	for (const [i, leg] of (legs as Record<string, unknown>[]).entries()) {
		if (leg.inTable ?? true) {
			if (leg.from !== undefined) fail(ctx, `legs[${i}].from${where}`, 'a table entry starts where the previous one ended; set `inTable: false` for a stretch of its own');
			if (leg.to === undefined) fail(ctx, `legs[${i}].to${where}`, 'required');
		} else if (leg.onProfile !== true) {
			fail(ctx, `legs[${i}]${where}`, 'an entry with `inTable: false` needs `onProfile: true`, or it shows nowhere');
		}
	}
}

/** The route list with its defaults filled in, each table entry starting at the previous one's `to`. */
function routeList(legs: Record<string, unknown>[]): Leg[] {
	let prev: Place | undefined;
	return legs.map((leg) => {
		const inTable = (leg.inTable as boolean | undefined) ?? true;
		const out = { ...leg, inTable, onProfile: (leg.onProfile as boolean | undefined) ?? false } as Leg;
		if (inTable) {
			out.from = prev;
			if (!prev) delete out.from;
			prev = out.to;
		}
		return out;
	});
}

/**
 * The hardest SAC grade among the non-optional route list entries, or
 * undefined. Of two equally hard grades (`T3`, `T1–T3`) the first wins, and
 * the entries off the table come first, as the old sections did before the legs.
 */
export function computedSac(facts: HikeAuthoredFacts): string | undefined {
	const legs = (facts.legs ?? []).filter((l) => !l.optional);
	const grades = [...legs.filter((l) => !l.inTable), ...legs.filter((l) => l.inTable)]
		.map((l) => l.sac)
		.filter((g): g is string => typeof g === 'string');
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
		resolve: (raw, path, warn) => resolver(raw, path, warn, source),
		record
	});

	// A library record, validated and resolved for each entry using it, so a
	// warning about one of its places names that entry before the record's own path.
	const record = (kind: LibraryKind, id: string, user: string): Entry | undefined => {
		const raw = input.library?.[kind]?.[id];
		if (raw === undefined) return undefined;
		return validateObj(ctxFor(`${user}: ${LIBRARY_SOURCE}`, false), RECORDS[kind], raw, `${kind}.${id}`, true) as Entry;
	};

	const sideCtx = ctxFor(input.sidecarSource, false);
	let side: Record<string, unknown> | undefined;
	if (input.sidecar != null) {
		rejectSections(sideCtx, input.sidecar);
		side = validate(sideCtx, FACTS, input.sidecar, '') as Record<string, unknown>;
		checkLegs(sideCtx, side.legs);
		for (const k of POST_ONLY) {
			if (k in side) {
				warnings.push(`Hike facts in ${input.sidecarSource}: ${k}: describes a single day, so only a post may set it; ignored`);
				delete side[k];
			}
		}
	}

	const postCtx = ctxFor(input.postSource, true);
	rejectSections(postCtx, postFacts);
	const post = postFacts != null ? validate(postCtx, FACTS, postFacts, '') as Record<string, unknown> : undefined;
	if (side === undefined && post === undefined) return { facts: null, warnings };

	const merged = clean(postCtx, FACTS, useRecords(postCtx, FACTS, merge(postCtx, FACTS, side, post, ''), ''), '') as HikeAuthoredFacts | undefined;
	if (!merged || Object.keys(merged).length === 0) return { facts: null, warnings };
	// The sidecar's list passed on its own; what the post changed is checked merged.
	if (post?.legs !== undefined) checkLegs(postCtx, merged.legs, Array.isArray(side?.legs));
	if (merged.legs) merged.legs = routeList(merged.legs as unknown as Record<string, unknown>[]);
	orderSpans(merged);

	// A stop on an OSM element (the whole store, else the hike's nodes) takes its contact details from OSM when neither the facts nor its library record give any.
	for (const stop of merged.stops ?? []) {
		const tags = (input.storeNodes ?? input.nodes ?? []).find((n) => n.ref != null && n.ref === stop.at.ref)?.tags;
		if (!tags) continue;
		const phone = tags.phone ?? tags['contact:phone'];
		const website = tags.website ?? tags['contact:website'];
		if (!stop.phone && typeof phone === 'string') stop.phone = phone;
		if (!stop.booking && typeof website === 'string') stop.booking = { url: webUrl(website) };
	}

	// Authored phone numbers read the same as OSM's: international, joined with "; ".
	for (const stop of merged.stops ?? []) {
		if (typeof stop.phone === 'string' && stop.at.lat != null && stop.at.lon != null) {
			stop.phone = formatPhones(stop.phone, stop.at.lat, stop.at.lon);
		}
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

	// Mirrors are my own uploads on other platforms; every one of them serves https.
	for (const [i, src] of (merged.sources ?? []).entries()) {
		if (src.kind === 'mirror' && !/^https:\/\//.test(src.url)) {
			throw new FactsError(`Hike facts: sources[${i}].url: a mirror needs an https URL, got "${src.url}"`);
		}
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

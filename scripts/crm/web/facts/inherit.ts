import { KM_RE, entryKey, type Spec } from '$lib/hikes/facts-spec';
import type { FieldOp } from '../../shared/ops';
import { REMOVE, editOp, type FactsCtx, type Path } from './facts-state';
import { normaliseTexts, textParts } from './form-model';

type FactsOp = Extract<FieldOp, { kind: 'facts' }>;
type ListSpec = Extract<Spec, { t: 'list' }>;
type Entry = Record<string, unknown>;

/**
 * One entry of a list the merge pairs by identity, as "This visit" shows it: the sidecar's entry, the post's entries
 * with the same identity (overrides, shown merged; or `remove: true` hiding it), or both. `postAt` is the index of the
 * first post entry, the one edits go to (for a hidden row, the `remove` entry), or the index a new one is appended at.
 * `record`: the shared record the row's entry starts from (a library list's), the visit's own `use` over the hike's.
 */
export type Row = { key: string; hike?: Entry; post?: Entry; removed: boolean; postAt: number; record?: Entry };

/** An entry's shared record, for a list whose entries start from one (`list.lib`); see shared.ts recordOf. */
export type RecordOf = (entry: Entry) => Entry | undefined;

const isObject = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether the merge pairs a post's list with the sidecar's entry by entry; any other list the post replaces whole. */
export function byEntry(list: ListSpec): boolean {
	return !!list.id && list.of.t === 'obj';
}

const kmPlace = (km: number) => ({ name: { en: `km ${km}` }, ref: `km ${km}`, resolved: true });

/**
 * A place as the site reads it before resolving it against OSM: a name (trimmed; the key normalises it), a km along the
 * route (`km 1` and `{km: 1}` alike), a ref or a lat/lon. A name and a ref of the same node pair on the site only once
 * resolved, which the tab can't do.
 */
function readPlace(v: unknown): unknown {
	if (typeof v === 'string' && v.trim()) {
		const km = KM_RE.exec(v.trim());
		return km ? kmPlace(parseFloat(km[1].replace(',', '.'))) : { name: { en: v.trim() }, resolved: false };
	}
	if (!isObject(v)) return v;
	if (typeof v.ref === 'string') return { name: { en: '' }, ref: v.ref, resolved: true };
	if (typeof v.km === 'number' && Object.keys(v).length === 1) return kmPlace(v.km);
	if (typeof v.lat === 'number' && typeof v.lon === 'number') return { name: { en: '' }, lat: v.lat, lon: v.lon, resolved: true };
	return v;
}

/** A value as the merge's key reads it once validated: strings and texts trimmed, a text as `{en}`, places as read. */
function readValue(spec: Spec | undefined, v: unknown): unknown {
	if (v == null || !spec) return v;
	switch (spec.t) {
		case 'str':
		case 'enum':
			return typeof v === 'string' ? v.trim() : typeof v === 'number' && spec.t === 'str' ? String(v) : v;
		case 'text':
			if (typeof v === 'string' || typeof v === 'number') return { en: String(v).trim() };
			return isObject(v) && typeof v.en === 'string' ? { ...v, en: v.en.trim() } : v;
		case 'place':
			return readPlace(v);
		case 'spot':
			// A named spot is keyed by its place when it has one the site needn't resolve, else by its name.
			if (isObject(v) && 'name' in v && !('lat' in v)) {
				const name = readValue({ t: 'text' }, v.name);
				const at = v.at == null ? undefined : (readPlace(v.at) as Entry);
				return { ...(at && !('resolved' in at && at.resolved === false) ? at : {}), name, resolved: true };
			}
			return readPlace(v);
		default:
			return v;
	}
}

/** An entry's identity as the merge reads it once validated; one that starts from a shared record, through the record. */
function keyOf(list: ListSpec, entry: Entry, record?: Entry): string {
	const f = (list.of as Extract<Spec, { t: 'obj' }>).f;
	const read = (e: Entry) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, readValue(f[k], v)]));
	return entryKey(list, read(entry), record && read(record));
}

/** Two post entries over one row, as the merge lays the second over the first: a text per language, else the later value. */
export function laid(list: ListSpec, base: Entry, over: Entry): Entry {
	const f = (list.of as Extract<Spec, { t: 'obj' }>).f;
	const out = { ...base };
	for (const [k, v] of Object.entries(over)) out[k] = f[k]?.t === 'text' && v != null && base[k] != null ? { ...textParts(base[k]), ...textParts(v) } : v;
	return out;
}

/**
 * The fields of an entry its identity is built from: each field whose absence would change the key. A `use` stays, so
 * the post's entry starts from the same shared record and is keyed through it as the sidecar's is.
 */
export function identityFields(list: ListSpec, entry: Entry, record?: Entry): Entry {
	const key = keyOf(list, entry, record);
	const out = { ...entry };
	for (const k of Object.keys(entry)) {
		if (k === 'use') continue;
		const { [k]: _, ...rest } = out;
		if (keyOf(list, rest, record) === key) delete out[k];
	}
	return out;
}

/**
 * A list's entries for "This visit", in merge order: the sidecar's, then the post's own. As in the merge, each post
 * entry folds into the first row still there with its key (a sidecar entry, or one an earlier post entry added); a
 * `remove` takes that row away, and one matching no row stays as a row of its own (the site warns about it). Entries of
 * a library list are keyed through the shared record `recordOf` finds for them, as the site keys them.
 */
export function inheritedRows(list: ListSpec, hike: unknown[] | undefined, post: unknown[] | undefined, recordOf: RecordOf = () => undefined): Row[] {
	if (!byEntry(list)) throw new Error('a list without identity is replaced whole, not paired by entry');
	const end = post?.length ?? 0;
	const rows: Row[] = (hike ?? []).filter(isObject).map((h) => {
		const record = recordOf(h);
		return { key: keyOf(list, h, record), hike: h, removed: false, postAt: end, ...(record ? { record } : {}) };
	});
	(post ?? []).forEach((p, j) => {
		if (!isObject(p)) return;
		const own = recordOf(p);
		const key = keyOf(list, p, own);
		const row = rows.find((r) => !r.removed && r.key === key);
		const record = own ? { record: own } : {};
		if (p.remove === true) {
			if (row) Object.assign(row, { post: p, removed: true, postAt: j });
			else rows.push({ key, post: p, removed: true, postAt: j, ...record });
		} else if (!row) rows.push({ key, post: p, removed: false, postAt: j, ...record });
		else if (row.post) Object.assign(row, { post: laid(list, row.post, p) }, record);
		else Object.assign(row, { post: p, postAt: j }, record);
	});
	return rows;
}

/**
 * The op setting one field of a row for this visit: into its (first) post entry when it has one, else a new post entry
 * with the identity fields of the sidecar's entry, so the merge pairs the two instead of adding a second entry, and its
 * required fields, which the site checks on a post's entry too (an entry using a shared record has them from the record).
 */
export function overrideOp(list: ListSpec, path: Path, row: Row, field: string, value: unknown): FactsOp {
	if (row.post) return editOp('post', [...path, row.postAt, field], value);
	const hike = row.hike ?? {};
	const req = list.lib && (hike.use != null || row.record) ? [] : ((list.of as Extract<Spec, { t: 'obj' }>).req ?? []);
	const required = Object.fromEntries(req.filter((k) => hike[k] != null).map((k) => [k, hike[k]]));
	const entry = { ...identityFields(list, hike, row.record), ...required, [field]: value };
	return { kind: 'facts', scope: 'post', path: [...path, row.postAt], value: normaliseTexts(list.of, entry) };
}

/** Hides a sidecar entry for this visit: a post entry of its identity fields and `remove: true`, in place of any override. */
export function hideOp(list: ListSpec, path: Path, row: Row): FactsOp {
	return { kind: 'facts', scope: 'post', path: [...path, row.postAt], value: { ...identityFields(list, row.hike ?? row.post ?? {}, row.record), remove: true } };
}

/** Removes a row's post entry: a hidden entry shows again, an overridden one is the hike's again. */
export function unhideOp(path: Path, row: Row): FactsOp {
	return { kind: 'facts', scope: 'post', path: [...path, row.postAt], remove: true };
}

/** A value set at `rest` below a field, as the field's own value: `[0, "amount"]` and 5 give `[{amount: 5}]`. */
export const nest = (rest: Path, v: unknown): unknown => rest.reduceRight<unknown>((acc, step) => (typeof step === 'number' ? [acc] : { [step]: acc }), v);

/** The ctx a hike entry's fields edit through: the visit's entry over it, made by the first edit; its identity fields stay the hike's. */
export function rowCtx(ctx: FactsCtx, list: ListSpec, path: Path, row: Row): FactsCtx {
	const base = [...path, row.postAt];
	const ids = Object.keys(identityFields(list, row.hike ?? {}, row.record));
	const own = (p: Path) => p.length === base.length + 1 && ids.includes(String(p[p.length - 1]));
	if (row.post) return { ...ctx, fixed: own };
	return {
		...ctx,
		fixed: own,
		edit: (p, v, debounce) => {
			// Nothing of the visit's to remove yet.
			if (v === REMOVE) return;
			const [field, ...rest] = p.slice(base.length);
			ctx.send(overrideOp(list, path, row, String(field), nest(rest, v)), debounce);
		}
	};
}

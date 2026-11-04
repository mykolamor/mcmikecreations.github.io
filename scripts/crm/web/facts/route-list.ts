import { specAt, type Spec } from '$lib/hikes/facts-spec';
import type { FieldOp } from '../../shared/ops';
import { REMOVE, editOp, type Scope } from './facts-state';
import { laid, type Row } from './inherit';
import { normaliseTexts } from './form-model';
import { namedLabel } from './place-value';

type FactsOp = Extract<FieldOp, { kind: 'facts' }>;
type ListSpec = Extract<Spec, { t: 'list' }>;
export type Leg = Record<string, unknown>;
/** A route list entry as the table shows it: where it runs, and whether it is a table row, a profile band or both. */
export type RouteRow = { index: number; from: string; to: string; kind: 'table' | 'profile' | 'both' };

const isObject = (v: unknown): v is Leg => !!v && typeof v === 'object' && !Array.isArray(v);
const inTable = (leg: Leg) => leg.inTable !== false;

/**
 * The entries with each table entry's effective `from`, as the site lays them (`routeList`): the previous table
 * entry's `to`, absent for the first (the start). An entry off the table keeps its own.
 */
export function chained(legs: unknown[]): Leg[] {
	let prev: unknown;
	return legs.map((v) => {
		const leg = isObject(v) ? { ...v } : {};
		if (inTable(leg)) {
			delete leg.from;
			if (prev !== undefined) leg.from = prev;
			prev = leg.to;
		}
		return leg;
	});
}

/**
 * "This visit"'s route list as the merge lays it: the rows still there, each the hike's entry with the visit's over it
 * (a text per language, as the site merges it).
 */
export function visitLegs(list: ListSpec, rows: Row[]): Leg[] {
	return rows
		.filter((r) => !r.removed)
		.map((r) => {
			const { remove: _, ...leg } = laid(list, r.hike ?? {}, r.post ?? {});
			return leg;
		});
}

/** The selected index once the entry at `from` moved to `to`: the moved entry follows, those it passed shift by one. */
export function selectionAfterMove(selected: number | null, from: number, to: number): number | null {
	if (selected === null) return null;
	if (selected === from) return to;
	if (from < selected && selected <= to) return selected - 1;
	if (to <= selected && selected < from) return selected + 1;
	return selected;
}

/** The selected index once the entry at `at` is gone: none when it was the selected one. */
export function selectionAfterRemove(selected: number | null, at: number): number | null {
	if (selected === null || selected === at) return null;
	return selected > at ? selected - 1 : selected;
}

/** Where a row shows in the merged list once it shows again: the merged rows (`merged` not null) before it. */
export function mergedBefore(rows: { merged: number | null }[], at: number): number {
	return rows.slice(0, at).filter((r) => r.merged !== null).length;
}

/** The selected index once an entry shows at `at` (a hidden one undone). */
export function selectionAfterInsert(selected: number | null, at: number): number | null {
	return selected !== null && selected >= at ? selected + 1 : selected;
}

/** The table's rows: an absent end of an entry off the table is the route's start or end. */
export function routeRows(legs: unknown[], names?: (ref: string) => string | undefined): RouteRow[] {
	return chained(legs).map((leg, index) => ({
		index,
		from: leg.from == null ? 'Start' : namedLabel(leg.from, names),
		to: leg.to == null ? (inTable(leg) ? '' : 'End') : namedLabel(leg.to, names),
		kind: !inTable(leg) ? 'profile' : leg.onProfile === true ? 'both' : 'table'
	}));
}

/**
 * The ops flipping "In table" or "On profile" of the entry at `index` (`entry` as `chained` gives it). The site needs
 * an entry off the table on the profile, with a span of its own: off the table writes `onProfile` and the effective
 * `from`; off the profile, an entry off the table goes back into it. A default (`inTable: true`, `onProfile: false`) is
 * written by removing the key, and a table entry has no `from`.
 */
export function toggleOps(scope: Scope, index: number, flag: 'inTable' | 'onProfile', on: boolean, entry: Leg): FactsOp[] {
	const op = (key: string, value: unknown) => editOp(scope, ['legs', index, key], value);
	const intoTable = () => [op('inTable', REMOVE), ...(entry.from !== undefined && !inTable(entry) ? [op('from', REMOVE)] : [])];
	if (flag === 'inTable') {
		if (on) return inTable(entry) ? [] : intoTable();
		return [op('inTable', false), op('onProfile', true), ...(entry.from !== undefined ? [op('from', entry.from)] : [])];
	}
	if (on) return [op('onProfile', true)];
	return [op('onProfile', REMOVE), ...(inTable(entry) ? [] : intoTable())];
}

/** A new entry at `at` (with its first value; never an empty one): the list set with it in place, the others as they are. */
export function insertOp(scope: Scope, list: unknown[], at: number, entry: Leg): FactsOp {
	const next = [...list];
	next.splice(at, 0, normaliseTexts(specAt(['legs', at]), entry));
	return { kind: 'facts', scope, path: ['legs'], value: next };
}

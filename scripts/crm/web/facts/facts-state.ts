import type { Lang } from '$lib/hikes/facts-schema';
import { specAt } from '$lib/hikes/facts-spec';
import type { FieldOp } from '../../shared/ops';
import { mergeText, normaliseTexts, textParts } from './form-model';
import type { SharedCtx } from './shared';
import { at, isContainer, removeAt, setAt, type Path } from '../../shared/tree';

export type Scope = 'hike' | 'post';
export type { Path };
type FactsOp = Extract<FieldOp, { kind: 'facts' }>;

/** What every field of the form edits through: the session language, and the scope's edits by path under `facts`. */
export type FactsCtx = {
	lang: Lang;
	scope: Scope;
	edit(path: Path, value: unknown, debounce: boolean): void;
	/** An op built whole (this visit's list entries, see inherit.ts). */
	send(op: FactsOp, debounce: boolean): void;
	/** A field this visit can't change: one identifying an entry the hike's list has. */
	fixed?(path: Path): boolean;
	move(path: Path, list: unknown[], from: number, to: number): void;
	/** The texts a text field's languages may come from (statedTexts). */
	stated(path: Path): unknown[];
	/** The open doc: its route for the place picker, its bailout files for a `gpx` field (a translation has no slug). */
	doc(): { slug?: string; date?: string | null; files?: unknown } | null;
	/** `record`: the `inherited` values are an entry's shared record (in either scope), not the hike's. */
	inherits?: 'record';
	/** The shared records (shared.ts); absent where none can be used, as inside a record. */
	shared?: SharedCtx;
	/** The texts Fill filled (DeepL drafts), by path, marked until edited. */
	draft?: { has(path: Path): boolean; clear(path: Path): void };
};

/** The value an edit passes to remove its key or list entry. */
export const REMOVE = Symbol('remove');

const isFacts = (op: FieldOp): op is FactsOp => 'kind' in op && op.kind === 'facts';

/** The op for one value under `facts`. A value holding texts (a whole entry) has them normalised; a text field's edit goes as typed. */
export function editOp(scope: Scope, path: Path, value: unknown): FactsOp {
	if (value === REMOVE) return { kind: 'facts', scope, path, remove: true };
	const spec = specAt(path);
	return { kind: 'facts', scope, path, value: spec?.t === 'text' ? value : normaliseTexts(spec, value) };
}

/** Moves a list's entry from `from` to `to`: the list set in its new order, entries as they are (so their bytes stay). */
export function moveOp(scope: Scope, path: Path, list: unknown[], from: number, to: number): FactsOp {
	const next = [...list];
	next.splice(to, 0, ...next.splice(from, 1));
	return { kind: 'facts', scope, path, value: next };
}

/** A scope's facts with the given facts ops applied in order, as the server would write them; undefined when none are left. */
export function localFacts(doc: { facts?: { hike: unknown; post: unknown } } | null | undefined, pending: FieldOp[], scope: Scope): unknown {
	const facts = doc?.facts?.[scope];
	const root: Record<string, unknown> = { facts: isContainer(facts) ? structuredClone(facts) : facts };
	for (const op of pending) {
		if (!isFacts(op) || op.scope !== scope || !op.path.length) continue;
		const path = ['facts', ...op.path];
		let value = op.remove ? undefined : op.value;
		// A null (the visit's "Remove for this visit") is written as it is.
		if (value != null && specAt(op.path)?.t === 'text') {
			const r = mergeText(at(root, path), textParts(value));
			// The server refuses it (and the batch with it): nothing changes.
			if ('error' in r) continue;
			value = r.value;
		}
		// A container the removal emptied goes too, up to `facts` (never a `[]` or `{}` left behind).
		if (value === undefined) removeAt(root, path);
		else setAt(root, path, value);
	}
	return root.facts ?? undefined;
}

/** The facts ops to show on top of the doc: those being sent (the doc doesn't have them until the save answers), then those queued. */
export function shownOps(queue: { inFlight(): FieldOp[]; pending(): FieldOp[] }): FieldOp[] {
	return [...queue.inFlight(), ...queue.pending()];
}

/**
 * Every text a field's languages may come from: the doc's value at `path`, and each op's value there (an op at the path
 * or at one above it, a whole entry). A text edit states each of their languages, so one cleared stays cleared however
 * the queue coalesces the edits after it.
 */
export function statedTexts(doc: { facts?: { hike: unknown; post: unknown } } | null | undefined, ops: FieldOp[], scope: Scope, path: Path): unknown[] {
	const out = [at(doc?.facts?.[scope], path)];
	for (const op of ops) {
		if (!isFacts(op) || op.scope !== scope || op.remove || op.path.length > path.length) continue;
		if (op.path.every((step, i) => step === path[i])) out.push(at(op.value, path.slice(op.path.length)));
	}
	return out.filter((v) => v != null);
}

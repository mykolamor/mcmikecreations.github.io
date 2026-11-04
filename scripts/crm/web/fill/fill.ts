/**
 * "Fill empty from English", free of the DOM: each surface gathers its English texts that have no translation yet
 * (`FillItem`s), DeepL translates them (`POST /api/deepl/translate`), and each answer is applied to the surface's state
 * as it is when the answer arrives, never over a text typed meanwhile. The surface then turns what changed into its
 * normal edits (body and field ops, facts text edits, a record draft, strings `set`s, sidecar `lang` ops).
 */
import { FACTS, RECORDS, type LibraryKind, type Spec } from '$lib/hikes/facts-spec';
import type { Lang } from '$lib/i18n/languages';
import { at, setAt, type Path } from '../../shared/tree';
import { linkValue, mergeText, textParts } from '../facts/form-model';
import { pointName, spotName, spotNameOf, withPointName } from '../facts/place-value';
import { blocks, insertBlock, pairBlocks, replaceBlock, type Block } from '../write/pairs';
import { mediaLines } from '../../shared/md-lines';
import type { createDocSession } from '../doc-session';
import type { FieldOp } from '../../shared/ops';

type Session = ReturnType<typeof createDocSession>;

export type FillKind = 'markdown' | 'plain' | 'table';

/** Why an answer isn't applied when a conflict was raised while it was on its way. */
export const CONFLICT_MEANWHILE = 'Changed on disk while DeepL was answering: resolve the conflict, then fill again';
/** A FillButton's `blocked` for doc sessions: the conflict of any of them. */
export const conflictOf =
	(...sessions: (Session | null)[]) =>
	(): string | null =>
		sessions.some((s) => s?.queue.status === 'conflict') ? CONFLICT_MEANWHILE : null;

/**
 * One English text to translate. `apply` puts its translation into a state of the surface: the new state, or null when
 * the target isn't empty any more (or its place can't be found).
 */
export type FillItem<S> = {
	id: string;
	text: string;
	kind: FillKind;
	label: string;
	apply(state: S, text: string): S | null;
	/** A facts text written as part of a whole value (a link, a point, a spot): that value's path, the edit to make there. */
	commitPath?: Path;
};

export type FillAnswer = { texts: { id: string; text: string }[]; refused: { id: string; reason: string }[] };
export type Applied<S> = { state: S; applied: string[]; skipped: string[]; filled: Record<string, string>; commitPaths: Record<string, Path> };
export type FillResult<S> = Applied<S> & { refused: { id: string; label: string; reason: string }[] };

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

const blank = (s: unknown) => typeof s !== 'string' || s.trim() === '';
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s).replace(/\s+/g, ' ');

// ---- a translation: its title, description and body

/** A translation as Fill reads it: the English body beside the translation's body and fields. */
export type DocFill = { en: string; body: string; title: string; description: string };

/** The `n`-th block of `list` whose text is `text`. */
const nth = (list: Block[], text: string, n: number) => list.filter((b) => b.text === text)[n];

/**
 * `state` with `text` as the translation of the English block (`enText`, its `n`-th occurrence), put after the
 * translation's block nearest above its row as the blocks pair now; null when that row has a translation already, or
 * the English block isn't there any more.
 */
function placeBlock(state: DocFill, enText: string, n: number, text: string): DocFill | null {
	const en = blocks(state.en);
	const block = nth(en, enText, n);
	if (!block) return null;
	const pairs = pairBlocks(en, blocks(state.body));
	const row = pairs.findIndex((p) => p.en === block);
	if (pairs[row].tr) return null;
	const after = pairs.slice(0, row).findLast((p) => p.tr)?.tr ?? null;
	const body = insertBlock(state.body, after, text);
	return body === null ? null : { ...state, body };
}

/**
 * `state` with `text` in place of the translation's photo or video block paired with the English one (`enText`, its
 * `n`-th occurrence); null when that partner isn't there or isn't the English text any more (its caption was translated).
 */
function replaceMedia(state: DocFill, enText: string, n: number, text: string): DocFill | null {
	const en = blocks(state.en);
	const block = nth(en, enText, n);
	if (!block) return null;
	const tr = pairBlocks(en, blocks(state.body)).find((p) => p.en === block)?.tr;
	if (!tr || tr.text !== enText) return null;
	const body = replaceBlock(state.body, tr, text);
	return body === null ? null : { ...state, body };
}

/**
 * What a translation lacks: its title and description when blank (and the English has one), each English block with
 * no partner (for a translation with an empty body, every one), and each photo or video block the translation has as
 * the English has it, a caption still English: it is filled in place, with the caption translated.
 */
export function gatherDoc(enBody: string, trBody: string, trFields: { title?: unknown; description?: unknown }, enFields: { title?: unknown; description?: unknown }): FillItem<DocFill>[] {
	const out: FillItem<DocFill>[] = [];
	for (const [field, label] of [['title', 'Title'], ['description', 'Description']] as const) {
		const en = enFields[field];
		if (blank(en) || !blank(trFields[field])) continue;
		out.push({
			id: `tr.${field}`,
			text: en as string,
			kind: 'plain',
			label,
			apply: (s, text) => (blank(s[field]) ? { ...s, [field]: text } : null)
		});
	}
	const en = blocks(enBody);
	for (const pair of pairBlocks(en, blocks(trBody))) {
		const b = pair.en;
		const copied = b?.kind === 'media' && pair.tr?.text === b.text && mediaLines(b.text).some((m) => /\p{L}/u.test(m.caption));
		if (!b || (pair.tr && !copied)) continue;
		const i = en.indexOf(b);
		const n = en.slice(0, i).filter((x) => x.text === b.text).length;
		const apply = copied ? (s: DocFill, text: string) => replaceMedia(s, b.text, n, text) : (s: DocFill, text: string) => placeBlock(s, b.text, n, text);
		out.push({ id: `block:${i}`, text: b.text, kind: 'markdown', label: `Block ${i + 1}: ${short(b.text)}`, apply });
	}
	return out;
}

/** A filled block's draft mark, by its text (line breaks as `\n`): the side by side view finds it again by that. */
export const blockDraftKey = (text: string): string => `block:${text.replace(/\r\n/g, '\n')}`;

const isField = (op: FieldOp): op is Extract<FieldOp, { field: string }> => !('kind' in op);

/**
 * A field's text as the doc will hold it once saved: queued, else being sent, else the doc's (`lang`: that language's
 * text of a translated field).
 */
export function currentField(session: Session, field: string, lang?: Lang): unknown {
	const op = [...session.queue.pending(), ...session.queue.inFlight()].find((o) => isField(o) && o.field === field && o.lang === lang);
	if (op && isField(op)) return op.value;
	return lang ? session.doc?.texts?.[field]?.[lang] : session.doc?.fields[field];
}

// ---- facts texts: the scope's own facts, or a shared record

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A text inside a value the form writes whole (a link's label, a point's or a spot's name): `read` gives the text from
 * the value (null: none of that kind any more), `write` the value with the text. Its `commitPath` is the value's.
 */
type Wrapped = { read(value: unknown): unknown; write(value: unknown, text: unknown): unknown };

const LINK: Wrapped = {
	read: (v) => (isObject(v) ? v.label : null),
	write: (v, label) => linkValue(String((v as Record<string, unknown>).url ?? ''), label)
};
const POINT: Wrapped = { read: (v) => pointName(v), write: withPointName };
const SPOT: Wrapped = { read: (v) => spotNameOf(v) ?? null, write: spotName };

/** The wrapper a value of `spec` has a text in, if any: a link's label, a point's name, a named spot's (or a name string's) name. */
function wrapperOf(v: unknown, s: Spec): Wrapped | null {
	if (s.t === 'link') return isObject(v) ? LINK : null;
	if (s.t === 'place' || s.t === 'spot') {
		if (pointName(v) !== null) return POINT;
		if (s.t === 'spot' && spotNameOf(v) !== undefined) return SPOT;
	}
	return null;
}

/** A source that mirrors the route on a platform: its title is that platform's name (Komoot, Strava), the same in every language. */
const isMirrorSource = (v: Record<string, unknown>, path: Path) => path.length === 2 && path[0] === 'sources' && v.kind === 'mirror';

/**
 * Every text under `value` (read by `spec`) with English and no `lang`; the state is that value, a path its id. A text
 * inside a link, a point or a spot is filled as its whole value (the text merged by the text rules), the item's
 * `commitPath` naming that value: the server writes a text's edit only at a text's own path.
 */
function gatherTexts(value: unknown, spec: Spec, lang: Lang): FillItem<unknown>[] {
	const out: FillItem<unknown>[] = [];
	const push = (path: Path, en: string, put: (state: unknown, text: string) => unknown | null, commitPath?: Path) =>
		out.push({ id: JSON.stringify(path), text: en, kind: 'markdown', label: `${path.join(' › ')}: ${short(en)}`, apply: put, ...(commitPath ? { commitPath } : {}) });
	/** The text `cur`'s translation `text`, or null when `cur` was translated meanwhile or its English changed. */
	const merged = (cur: unknown, en: string, text: string): unknown | null => {
		const parts = textParts(cur);
		if (!blank(parts[lang]) || parts.en !== en) return null;
		const r = mergeText(cur, { [lang]: text });
		return 'value' in r ? r.value : null;
	};
	/** `state` with `value` at `path` (a copy). */
	const withAt = (state: unknown, path: Path, value: unknown) => {
		const next = structuredClone(state) as Record<string, unknown>;
		setAt(next, path, value);
		return next;
	};
	const walk = (v: unknown, s: Spec | undefined, path: Path) => {
		if (v == null || !s) return;
		const wrap = wrapperOf(v, s);
		if (wrap) {
			const en = textParts(wrap.read(v)).en;
			if (blank(en) || !blank(textParts(wrap.read(v))[lang])) return;
			const key = wrap === LINK ? 'label' : 'name';
			push(
				[...path, key],
				en,
				(state, text) => {
					const cur = at(state, path);
					// No longer a value of that kind (a link made a plain URL, a point re-picked as a place).
					if (cur == null || wrapperOf(cur, s) !== wrap) return null;
					const t = merged(wrap.read(cur), en, text);
					return t === null ? null : withAt(state, path, wrap.write(cur, t));
				},
				path
			);
		} else if (s.t === 'text') {
			const en = textParts(v).en;
			if (blank(en) || !blank(textParts(v)[lang])) return;
			push(path, en, (state, text) => {
				const cur = textParts(at(state, path));
				// Translated meanwhile, or its English changed: the answer is of another text.
				if (!blank(cur[lang]) || cur.en !== en) return null;
				return withAt(state, path, { ...cur, [lang]: text });
			});
		} else if (s.t === 'list' && Array.isArray(v)) v.forEach((x, i) => walk(x, s.of, [...path, i]));
		else if (s.t === 'obj' && isObject(v)) {
			for (const [k, x] of Object.entries(v)) if (!(k === 'title' && isMirrorSource(v, path))) walk(x, s.f[k], [...path, k]);
		}
	};
	walk(value, spec, []);
	return out;
}

/** The texts of a scope's facts (`localFacts`) with English and no `lang`, by their path under `facts`. */
export const gatherFacts = (facts: unknown, lang: Lang): FillItem<unknown>[] => gatherTexts(facts, FACTS, lang);

/** The same for a shared record's draft, by its path in the record. */
export const gatherRecord = (record: unknown, lang: Lang, kind: LibraryKind): FillItem<unknown>[] => gatherTexts(record, RECORDS[kind], lang);

// ---- the label tables and the route words

/** The table's missing keys; the state is each key's text as typed (a paragraph list as one text, as the tab edits it). */
export function gatherStrings(rows: { key: string; en: string | string[]; missing: boolean }[]): FillItem<Record<string, string>>[] {
	return rows
		.filter((r) => r.missing)
		.map((r) => ({
			id: r.key,
			text: Array.isArray(r.en) ? r.en.join('\n\n') : r.en,
			kind: 'table' as const,
			label: r.key,
			apply: (s: Record<string, string>, text: string) => (blank(s[r.key]) ? { ...s, [r.key]: text } : null)
		}));
}

/** The sidecar's `name` and `description` (`ClientDoc.texts`) with English and no `lang`. */
export function gatherRoute(texts: Record<string, Record<string, string>>, lang: Lang): FillItem<Record<string, Record<string, string>>>[] {
	return Object.entries(texts).flatMap(([field, parts]) => {
		const en = parts.en;
		if (blank(en) || !blank(parts[lang])) return [];
		return [
			{
				id: field,
				text: en,
				kind: 'plain' as const,
				label: field === 'sidecar.name' ? 'Name' : 'Description',
				apply: (s: Record<string, Record<string, string>>, text: string) => {
					const cur = s[field] ?? {};
					return !blank(cur[lang]) || cur.en !== en ? null : { ...s, [field]: { ...cur, [lang]: text } };
				}
			}
		];
	});
}

// ---- applying

/**
 * Applies each answer to `current` in order where its target is still empty: the new state, the ids applied and those
 * skipped, the text filled in for each applied id, and the `commitPath` of each applied one that has one.
 */
export function applyFill<S>(items: FillItem<S>[], answers: { id: string; text: string }[], current: S): Applied<S> {
	const byId = new Map(items.map((i) => [i.id, i]));
	let state = current;
	const applied: string[] = [];
	const skipped: string[] = [];
	const filled: Record<string, string> = {};
	const commitPaths: Record<string, Path> = {};
	for (const a of answers) {
		const item = byId.get(a.id);
		if (!item) continue;
		const next = item.apply(state, a.text);
		if (next === null) skipped.push(a.id);
		else {
			state = next;
			applied.push(a.id);
			filled[a.id] = a.text;
			if (item.commitPath) commitPaths[a.id] = item.commitPath;
		}
	}
	return { state, applied, skipped, filled, commitPaths };
}

/**
 * Translates `items` into `lang` and applies the answers to `current()` as it is when they arrive (`applyFill`). A
 * failed request (no key, quota, rate limit, HTTP, network) rejects, and nothing is read or applied; the texts DeepL
 * answered with changed formatting are listed in `refused`, kept empty. `blocked`, asked when the answer arrives, names
 * what keeps it from being applied now (a conflict raised meanwhile): then it rejects with that, and nothing is applied.
 */
export async function runFill<S>(lang: Lang, items: FillItem<S>[], current: () => S, request: Request, blocked: () => string | null = () => null): Promise<FillResult<S>> {
	if (!items.length) return { state: current(), applied: [], skipped: [], filled: {}, commitPaths: {}, refused: [] };
	const answer = await request<FillAnswer>('POST', '/api/deepl/translate', { lang, texts: items.map(({ id, text, kind }) => ({ id, text, kind })) });
	const why = blocked();
	if (why) throw new Error(why);
	const labels = new Map(items.map((i) => [i.id, i.label]));
	const refused = answer.refused.map((r) => ({ id: r.id, label: labels.get(r.id) ?? r.id, reason: r.reason }));
	return { ...applyFill(items, answer.texts, current()), refused };
}

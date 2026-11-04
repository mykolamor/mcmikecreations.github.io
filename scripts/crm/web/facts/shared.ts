import { KM_RE, LIBRARY_ID_RE, RECORDS, specAt, type LibraryKind } from '$lib/hikes/facts-spec';
import type { FactsLibrary } from '$lib/hikes/facts-library.server';
import { normalizePlaceName } from '$lib/hikes/place-links';
import type { FieldOp } from '../../shared/ops';
import { LIST_PATHS, recordId } from '../../shared/library-id';
import { REMOVE, editOp, type FactsCtx, type Path, type Scope } from './facts-state';
import { mergeText, normaliseTexts, textParts } from './form-model';
import { at, isObject, removeAt, setAt } from '../../shared/tree';

type FactsOp = Extract<FieldOp, { kind: 'facts' }>;
type Entry = Record<string, unknown>;

/** What `GET /api/facts/library` answers: the file's version, its records, and the docs taking each `"<kind>/<id>"`. */
export type LibraryState = { version: string; library: FactsLibrary; usage: Record<string, string[]> };

/** What the form reaches the shared records through. */
export type SharedCtx = {
	/** The library and its usage; null until loaded. */
	state(): LibraryState | null;
	/** The stops of the preview's last good reading, their places resolved (stopRef). */
	stops(): unknown[];
	/**
	 * Sets (or with null deletes) a record on library version `base` (the loaded one when left out): the server's message
	 * when refused, else null.
	 */
	put(kind: LibraryKind, id: string, record: Entry | null, base?: string): Promise<string | null>;
	/** Reads the library and its usage again (another doc may have taken a record since): the new state, or null when it fails. */
	reload(): Promise<LibraryState | null>;
};

/** One library request: `GET /api/facts/library`, or `PUT /api/facts/library/record` with `body`; throws ApiClientError. */
export type LibraryCall = (method: 'GET' | 'PUT', body?: unknown) => Promise<LibraryState>;

export const STALE_LIBRARY = 'The shared records changed on disk (another tab or the CLI) and were read again; nothing was saved. Check and save again.';

/**
 * The tab's copy of the library: read with `load`, replaced by each write's answer (`show` gets each state taken). An
 * answer to a request that started before the last answer taken is dropped, so an older read never undoes a newer write.
 */
export function libraryClient(call: LibraryCall, show: (state: LibraryState) => void) {
	let state: LibraryState | null = null;
	let started = 0;
	let taken = 0;
	async function send(method: 'GET' | 'PUT', body?: unknown): Promise<LibraryState | null> {
		const seq = ++started;
		const answer = await call(method, body);
		if (seq < taken) return null;
		taken = seq;
		state = answer;
		show(answer);
		return answer;
	}
	const client = {
		state: () => state,
		/** The library as it is now; null when this read was overtaken by a newer answer (`state()` has that). Throws when it fails. */
		load: () => send('GET'),
		async put(kind: LibraryKind, id: string, record: Entry | null, base?: string): Promise<string | null> {
			const on = base ?? state?.version;
			if (on === undefined) return 'The shared records are not loaded';
			try {
				await send('PUT', { kind, id, record, base: on });
				return null;
			} catch (e) {
				if ((e as { status?: number }).status === 409) {
					void client.load().catch(() => {});
					return STALE_LIBRARY;
				}
				return e instanceof Error ? e.message : String(e);
			}
		}
	};
	return client;
}

/**
 * A record open for editing: its local draft, and the library version it was copied from, which the save is made on, so
 * a change made elsewhere since is refused (409) rather than overwritten. `touched` once the author edits the draft.
 */
export type RecordSession = { base: string; draft: Entry; touched: boolean };

export function recordSession(state: LibraryState, kind: LibraryKind, id: string): RecordSession {
	return { base: state.version, draft: structuredClone((state.library[kind] as Record<string, Entry>)[id] ?? {}), touched: false };
}

/**
 * A later reading of the library for an open record: an untouched draft takes the record and version as they are now
 * (the open's own reload); a touched one keeps its base, so a reading made for the save's question never becomes it.
 */
export function refreshSession(session: RecordSession, state: LibraryState, kind: LibraryKind, id: string): RecordSession {
	return session.touched ? session : recordSession(state, kind, id);
}

/**
 * The OSM ref a stop's `at` names: a `{ref}`, or for a name the place the site resolved it to (`resolved`: the stops
 * of the preview's reading, whose `at` carries the ref); null when it names none (a km, a point, an unresolved name).
 */
export function stopRef(at: unknown, resolved: unknown[] = []): string | null {
	if (isObject(at)) return typeof at.ref === 'string' ? at.ref : null;
	if (typeof at !== 'string' || !at.trim() || KM_RE.test(at.trim())) return null;
	const name = normalizePlaceName(at);
	for (const stop of resolved) {
		const place = isObject(stop) && isObject(stop.at) ? stop.at : null;
		const en = place && isObject(place.name) ? place.name.en : undefined;
		if (place && typeof place.ref === 'string' && typeof en === 'string' && normalizePlaceName(en) === name) return place.ref;
	}
	return null;
}

/** The record an entry starts from: its `use`, or for a stop the record of the place its `at` names (stopRef). */
export function recordOf(kind: LibraryKind, entry: unknown, library: FactsLibrary | null | undefined, resolved?: unknown[]): Entry | undefined {
	if (!isObject(entry) || !library) return undefined;
	const id = kind === 'stops' ? stopRef(entry.at, resolved) : typeof entry.use === 'string' ? entry.use : null;
	const records = library[kind] as Record<string, Entry>;
	return id != null && Object.hasOwn(records, id) ? records[id] : undefined;
}

/** The id an entry's record is under: its `use`, or a stop's ref. */
export function recordIdOf(kind: LibraryKind, entry: unknown, resolved?: unknown[]): string | null {
	if (!isObject(entry)) return null;
	return kind === 'stops' ? stopRef(entry.at, resolved) : typeof entry.use === 'string' ? entry.use : null;
}

/**
 * A new record made from an entry: the record is the entry's fields (not its `use`, nor a stop's `at`, which is its
 * key), texts as the server keeps them; the entry becomes `{use: id}`, a stop `{at}` as written. The client writes the
 * record first, then the ops.
 */
export function newRecordOps(kind: LibraryKind, id: string, entryPath: Path, entry: Entry, scope: Scope): { record: Entry; ops: FactsOp[] } {
	const { use: _, ...fields } = entry;
	const { at, ...rest } = fields;
	const record = normaliseTexts(RECORDS[kind], kind === 'stops' ? rest : fields) as Entry;
	return { record, ops: [{ kind: 'facts', scope, path: entryPath, value: kind === 'stops' ? { at } : { use: id } }] };
}

/**
 * An edit inside an entry that starts from a record (`field`: the path below the entry): that value alone, written into
 * the entry, so the entry keeps following the record for every other field. Removing a value the entry doesn't hold
 * (the record's shows) writes nothing: null.
 */
export function entryEditOp(scope: Scope, entryPath: Path, entry: Entry | undefined, field: Path, value: unknown): FactsOp | null {
	if (value === REMOVE && at(entry, field) === undefined) return null;
	return editOp(scope, [...entryPath, ...field], value);
}

/**
 * The ctx an entry that starts from a record edits through: its fields show the record's values as inherited, and each
 * edit writes the one value into the entry (entryEditOp).
 */
export function recordCtx(ctx: FactsCtx, entryPath: Path, entry: Entry | undefined): FactsCtx {
	const use = [...entryPath, 'use'];
	return {
		...ctx,
		inherits: 'record',
		// Its `use` found the record, which the status line names; only a dangling one stays editable.
		fixed: (p) => (p.length === use.length && p.every((step, i) => step === use[i])) || !!ctx.fixed?.(p),
		edit: (p, v, debounce) => {
			const op = entryEditOp(ctx.scope, entryPath, entry, p.slice(entryPath.length), v);
			if (op) ctx.send(op, debounce);
		}
	};
}

/**
 * One edit of a record open in the form, on its local copy: a text by the same rule as an entry's (an empty language
 * cleared, English required beside a translation: `error`), `REMOVE` taking the value away with any list or map it
 * leaves empty. The record is saved whole (normaliseTexts) when the author saves it.
 */
export function recordEdit(kind: LibraryKind, record: Entry, path: Path, value: unknown): { record: Entry } | { error: string } {
	const root: Record<string, unknown> = { r: structuredClone(record) };
	const full: Path = ['r', ...path];
	let v = value;
	if (v !== REMOVE && specAt(path, RECORDS[kind])?.t === 'text') {
		const r = mergeText(at(root, full), textParts(v));
		if ('error' in r) return r;
		v = r.value === undefined ? REMOVE : r.value;
	}
	// The record itself stays, emptied or not.
	if (v === REMOVE) removeAt(root, full, 1);
	else setAt(root, full, v);
	return { record: root.r as Entry };
}

/** The docs taking a record, and how many hikes they are (a hike's posts count once). */
export function recordUsers(usage: Record<string, string[]>, kind: LibraryKind, id: string): { hikes: number; docs: string[] } {
	const docs = usage[`${kind}/${id}`] ?? [];
	return { hikes: new Set(docs.map((d) => d.replace(/^\d{4}-\d{2}-\d{2}-/, ''))).size, docs };
}

/**
 * Whether a facts op may change which record an entry takes, so the usage is read again once it is saved: one setting
 * or removing an entry's `use` (a stop's `at`), a whole entry or list, or a container above a library list.
 */
export function touchesRecord(op: FieldOp): boolean {
	if (!('kind' in op) || op.kind !== 'facts') return false;
	return Object.entries(LIST_PATHS).some(([kind, list]) => {
		const n = Math.min(op.path.length, list.length);
		if (!op.path.slice(0, n).every((step, i) => step === list[i])) return false;
		return op.path.length <= list.length + 1 || op.path[list.length + 1] === (kind === 'stops' ? 'at' : 'use');
	});
}

/** A record id a new record can't take: one another doc's entry uses (one no doc uses, a retry's leftover, is reused). */
function usedId(state: LibraryState, kind: LibraryKind, id: string): boolean {
	return Object.hasOwn(state.library[kind], id) && recordUsers(state.usage, kind, id).docs.length > 0;
}

/** The id "New shared record" proposes: a stop's place's ref, else the Plan 2 rule over the ids in use. */
export function newRecordId(kind: LibraryKind, entry: Entry, state: LibraryState, resolved?: unknown[]): string {
	if (kind === 'stops') return stopRef(entry.at, resolved) ?? '';
	const used = Object.fromEntries(Object.keys(state.library[kind]).filter((id) => usedId(state, kind, id)).map((id) => [id, true]));
	return recordId(kind, entry, used);
}

/** Why a new record can't take `id`, or null. */
export function idProblem(kind: LibraryKind, id: string, state: LibraryState): string | null {
	if (kind === 'stops' && !id) return "A stop's record is keyed by its OSM element: pick the stop's place from the store first";
	if (kind !== 'stops' && !LIBRARY_ID_RE.test(id)) return 'An id is lowercase words joined by "-"';
	return usedId(state, kind, id) ? `"${id}" is taken` : null;
}

/** The question before a save that reaches more than one hike; null for one hike or none. */
export function changesText(users: { hikes: number; docs: string[] }): string | null {
	return users.hikes > 1 ? `This changes ${users.hikes} hikes: ${users.docs.join(', ')}` : null;
}

/** A record in words, for the picker: its id and what it is. */
export function recordLabel(kind: LibraryKind, id: string, record: Entry, names?: (ref: string) => string | undefined): string {
	const en = (v: unknown) => textParts(v).en ?? (isObject(v) && 'ref' in v ? String(v.ref) : '');
	const what = kind === 'stops' ? (names?.(id) ?? '') : kind === 'transport' ? [record.mode, record.line, en(record.from) && `${en(record.from)} → ${en(record.to)}`].filter(Boolean).join(' ') : en(record.name);
	return what ? `${what} (${id})` : id;
}

/** A kind's records matching `query` (any word of the label, case aside), by label. */
export function filterRecords(kind: LibraryKind, library: FactsLibrary, query: string, names?: (ref: string) => string | undefined): { id: string; label: string }[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return Object.entries(library[kind] as Record<string, Entry>)
		.map(([id, record]) => ({ id, label: recordLabel(kind, id, record, names) }))
		.filter((r) => words.every((w) => r.label.toLowerCase().includes(w)))
		.sort((a, b) => a.label.localeCompare(b.label));
}

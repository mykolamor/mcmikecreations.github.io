// Near-duplicates of the shared facts library's kinds: entries in two or more places whose key matches but whose
// content differs (stops by OSM ref, transport by mode/from/to/line, lifts and tickets by name, parking by name and
// at). Plan 2's extraction one-off printed them once; the Facts tab reads them fresh from the files, and merges a group
// into a shared record or keeps it apart (scripts/crm/data/near-duplicates-kept.json).
//
// A merge makes the chosen entry a record (an entry minus its `use`, a stop minus its `at`); every entry of the group
// becomes `{ use }` (a stop `{ at }`) plus the fields where it differs from the record, so no page changes. An entry
// that lacks a value the record has stays as it is (a sidecar can't say "none" over a record). The merge is read as the
// build reads it before anything is written; then the library goes first, then each file through `saveOps`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REF_RE } from '../../../src/lib/data/osm-store.js';
import { FactsError, readHikeFacts, validateLibraryRecord, type FactsNode, type ReadFactsInput } from '$lib/hikes/facts.server';
import { LIBRARY_ID_RE, LIBRARY_KINDS, type FactsLibrary, type LibraryKind } from '$lib/hikes/facts-library.server';
import { readFrontmatterDoc } from './frontmatter';
import { applyOps, type FieldOp } from '../shared/ops';
import { clientDoc, loadDoc, saveOps, writeAtomic } from '../server/doc';
import { withDocLock } from '../server/doc-lock';
import { lockKey, type DocRef } from '../server/doc-ref';
import { ApiError } from '../server/errors';
import { factsDocs, libraryOf, readDocFacts } from '../server/facts-read';
import { libraryState, libraryVersion, putLibraryRecord } from '../server/facts-library-api';
import { repoPaths } from '../server/paths';
import { renderInputs } from '../server/preview';
import { LIST_PATHS, label } from '../shared/library-id';

export type Entry = Record<string, unknown>;
export type Key = string | number;

export interface NearDuplicateGroup {
	kind: LibraryKind;
	key: string;
	/** `diff`: this entry's value of each field the group's entries disagree on. */
	entries: { file: string; path: string; diff: string[] }[];
}

export const isObj = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys: two entries are the same whatever their key order. */
export function canonical(v: unknown): string {
	return JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)) ?? 'undefined';
}

/** The fields a near-duplicate group shares, as a readable key, and as an exact one. */
function groupKey(kind: LibraryKind, e: Entry, ref: string | undefined): [string, string] | null {
	switch (kind) {
		case 'stops':
			return ref ? [ref, ref] : null;
		case 'transport':
			return [`${label(e.mode)} ${e.line != null ? `${label(e.line)} ` : ''}${label(e.from)} → ${label(e.to)}`, canonical([e.mode, e.from, e.to, e.line])];
		case 'parking':
			return [[label(e.name), label(e.at)].filter(Boolean).join(' at '), canonical([e.name, e.at])];
		default:
			return e.name === undefined ? null : [label(e.name), canonical(e.name)];
	}
}

/** What the build reads a post's facts with, apart from the facts. */
export type Context = Omit<ReadFactsInput, 'post' | 'sidecar' | 'library'>;

export interface Doc {
	/** The file name, `duernbachwand.hike.json` or `2026-09-20-duernbachwand.md`. */
	name: string;
	file: string;
	raw: string;
	sidecar: boolean;
	facts: Entry;
	/** The posts the facts render on (a sidecar's: its hike's posts, else the hike alone). */
	contexts: Context[];
	/** For a post, its hike's sidecar facts; for a sidecar, each context's post facts. */
	partners: (Entry | undefined)[];
}

export interface Copy {
	doc: Doc;
	kind: LibraryKind;
	index: number;
	entry: Entry;
	/** A stop's OSM ref, the same on every context; undefined when it has none. */
	ref?: string;
	/** Already a reference: it `use`s a record, or is a stop whose ref has one. */
	linked: boolean;
}

export const pathOf = (c: Copy): Key[] => [...LIST_PATHS[c.kind], c.index];
export const pathText = (c: Copy): string => `${LIST_PATHS[c.kind].join('.')}[${c.index}]`;

function readContext(root: string, slug: string, date: string | null, name: string): Context {
	const p = repoPaths(root);
	const inputs = renderInputs(root, date ? { kind: 'post', slug, date } : { kind: 'hike', slug });
	const storeNodes = inputs.nodes as FactsNode[];
	const own = new Set(inputs.ownRefs);
	return {
		postSource: date ? `${date}-${slug}.md` : name,
		sidecarSource: `${slug}.hike.json`,
		nodes: storeNodes.filter((n) => n.ref != null && own.has(n.ref)),
		storeNodes,
		origin: inputs.origin,
		height: inputs.height,
		ownRefs: inputs.ownRefs,
		coords: null,
		distanceFactor: 1,
		readGpx: (served) => {
			const file = path.join(p.static, served);
			return existsSync(file) ? readFileSync(file, 'utf8') : null;
		}
	};
}

export function postFacts(raw: string): Entry | undefined {
	const facts = readFrontmatterDoc(raw).doc.toJS()?.facts;
	return isObj(facts) ? facts : undefined;
}

/** Every sidecar and post that has facts, with the posts each renders on. */
export function readDocs(root: string): Doc[] {
	const dir = repoPaths(root).markdown;
	const names = readdirSync(dir).sort();
	const posts = new Map<string, string[]>();
	for (const name of names) {
		const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(name);
		if (m && names.includes(`${m[2]}.hike.json`)) posts.set(m[2], [...(posts.get(m[2]) ?? []), m[1]]);
	}
	const docs: Doc[] = [];
	for (const name of names) {
		const file = path.join(dir, name);
		if (name.endsWith('.hike.json')) {
			const raw = readFileSync(file, 'utf8');
			const facts = (JSON.parse(raw) as Entry).facts;
			if (!isObj(facts)) continue;
			const slug = name.slice(0, -'.hike.json'.length);
			const dates = posts.get(slug) ?? [];
			const contexts = dates.length ? dates.map((d) => readContext(root, slug, d, name)) : [readContext(root, slug, null, name)];
			const partners = dates.length ? dates.map((d) => postFacts(readFileSync(path.join(dir, `${d}-${slug}.md`), 'utf8'))) : [undefined];
			docs.push({ name, file, raw, sidecar: true, facts, contexts, partners });
			continue;
		}
		const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(name);
		if (!m || !posts.get(m[2])?.includes(m[1])) continue;
		const raw = readFileSync(file, 'utf8');
		const facts = postFacts(raw);
		if (!facts) continue;
		const side = (JSON.parse(readFileSync(path.join(dir, `${m[2]}.hike.json`), 'utf8')) as Entry).facts;
		docs.push({ name, file, raw, sidecar: false, facts, contexts: [readContext(root, m[2], m[1], name)], partners: [isObj(side) ? side : undefined] });
	}
	return docs;
}

export function getIn(v: unknown, keys: Key[]): unknown {
	return keys.reduce<unknown>((at, k) => (at == null ? undefined : (at as Record<Key, unknown>)[k]), v);
}

/** The facts holding only this one entry, where the doc has it. */
export function lone(kind: LibraryKind, entry: Entry): Entry {
	const [first, second] = LIST_PATHS[kind];
	return second ? { [first]: { [second]: [entry] } } : { [first]: [entry] };
}

/** The OSM ref a stop's `at` resolves to on every context of its doc, else undefined. */
function docStopRef(doc: Doc, entry: Entry): string | undefined {
	const refs = new Set(
		doc.contexts.map((ctx) => {
			const facts = readHikeFacts({ ...ctx, sidecar: doc.sidecar ? lone('stops', entry) : undefined, post: doc.sidecar ? undefined : lone('stops', entry) }).facts;
			return facts?.stops?.[0]?.at.ref ?? '';
		})
	);
	const [ref] = refs;
	return refs.size === 1 && ref ? ref : undefined;
}

/** Every entry of a library kind in `docs` (not a `remove`), with its stop's ref and whether `library` has its record. */
export function readCopies(docs: Doc[], library: FactsLibrary): Copy[] {
	const copies: Copy[] = [];
	for (const doc of docs) {
		for (const kind of LIBRARY_KINDS) {
			const list = getIn(doc.facts, LIST_PATHS[kind]);
			if (!Array.isArray(list)) continue;
			for (const [index, entry] of list.entries()) {
				if (!isObj(entry) || entry.remove === true) continue;
				const ref = kind === 'stops' ? docStopRef(doc, entry) : undefined;
				const linked = kind === 'stops' ? ref !== undefined && ref in library.stops : entry.use != null;
				copies.push({ doc, kind, index, entry, ref, linked });
			}
		}
	}
	return copies;
}

/** The entry as the build reads it: its record with its own fields on top (shallow, enough to compare). */
function effective(c: Copy, library: FactsLibrary): Entry {
	if (c.kind === 'stops') {
		const record = c.ref ? library.stops[c.ref] : undefined;
		return record ? { ...(record as Entry), ...c.entry } : c.entry;
	}
	const record = typeof c.entry.use === 'string' ? (library[c.kind] as Record<string, unknown>)[c.entry.use] : undefined;
	const { use: _, ...own } = c.entry;
	return isObj(record) ? { ...record, ...own } : own;
}

/** A group with its copies, each read as the build reads it (`e`; a stop without its `at`). */
type Members = { id: string; kind: LibraryKind; key: string; members: { copy: Copy; e: Entry }[] };

function groupsOf(copies: Copy[], library: FactsLibrary): Members[] {
	const groups = new Map<string, Members>();
	for (const copy of copies) {
		const e = effective(copy, library);
		const key = groupKey(copy.kind, e, copy.ref);
		if (!key) continue;
		const id = `${copy.kind}|${key[1]}`;
		if (!groups.has(id)) groups.set(id, { id, kind: copy.kind, key: key[0], members: [] });
		// A stop's group is its place, so its `at` spelling isn't a difference.
		const { at: _, ...rest } = e;
		groups.get(id)!.members.push({ copy, e: copy.kind === 'stops' ? rest : e });
	}
	// Entries that all take one record differ on purpose (a merged group): not near-duplicates.
	const shared = ({ members }: Members) => members.every(({ copy }) => copy.linked && (copy.kind === 'stops' || copy.entry.use === members[0].copy.entry.use));
	return [...groups.values()].filter((g) => new Set(g.members.map((m) => canonical(m.e))).size > 1 && !shared(g));
}

/** The near-duplicate groups among `copies`, each entry with its values of the fields the group disagrees on. */
export function nearDuplicates(copies: Copy[], library: FactsLibrary): NearDuplicateGroup[] {
	return listed(copies, library).map(({ id: _, record: __, ...g }) => g);
}

/**
 * A group as the Facts tab lists it: also its `id`, the exact key (two groups whose labels match, a translation apart,
 * stay two), and the `record` some of its entries take already (a merge that stopped part way), which a retry reuses.
 */
export type ListedGroup = NearDuplicateGroup & { id: string; record?: string };

function listed(copies: Copy[], library: FactsLibrary): ListedGroup[] {
	return groupsOf(copies, library).map(({ id, kind, key, members }) => {
		const fields = [...new Set(members.flatMap((m) => Object.keys(m.e)))];
		const differ = fields.filter((f) => new Set(members.map((m) => canonical(m.e[f]))).size > 1);
		const taken = members.find(({ copy }) => copy.kind !== 'stops' && typeof copy.entry.use === 'string')?.copy.entry.use as string | undefined;
		return {
			id,
			kind,
			key,
			...(taken ? { record: taken } : {}),
			entries: members.map(({ copy, e }) => ({
				file: copy.doc.name,
				path: pathText(copy),
				diff: differ.map((f) => `${f}: ${e[f] === undefined ? '(none)' : JSON.stringify(e[f])}`)
			}))
		};
	});
}

// ---------------------------------------------------------------------------
// Keep apart

/** `group` is the group's id; its kind and label are there to read. */
type Kept = { kind: string; key: string; group: string };
const KEPT_LOCK = 'near-duplicates-kept';
const keptFile = (root: string) => path.join(repoPaths(root).crmData, 'near-duplicates-kept.json');

function readKept(root: string): Kept[] {
	const file = keptFile(root);
	return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Kept[]) : [];
}

/** The groups as the files are now, without those kept apart. */
export function nearDuplicateGroups(root: string): ListedGroup[] {
	const library = libraryOf(root);
	const kept = new Set(readKept(root).map((k) => k.group));
	return listed(readCopies(readDocs(root), library), library).filter((g) => !kept.has(g.id));
}

/** Adds a group (`group`, its id) to the keep-apart list (once). */
export function keepApart(root: string, kind: string, key: string, group: string): Promise<Kept[]> {
	if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, `kind must be one of: ${LIBRARY_KINDS.join(', ')}`);
	return withDocLock(KEPT_LOCK, () => {
		const kept = readKept(root);
		if (kept.some((k) => k.group === group)) return kept;
		const next = [...kept, { kind, key, group }];
		writeAtomic(keptFile(root), JSON.stringify(next, null, '\t') + '\n');
		return next;
	});
}

// ---------------------------------------------------------------------------
// Merge

/** `group`: the group's id (ListedGroup); `id`: the record's. */
export type MergeRequest = { group: string; chosen: { file: string; path: string }; id: string };

export type MergeResult = {
	ok: boolean;
	/** The failure, naming its file; the files before it stay written. */
	error?: string;
	library: 'written';
	files: { file: string; status: 'saved' | 'failed' | 'not written'; error?: string }[];
	/** Entries left as they are, with the reason. */
	kept: { file: string; path: string; reason: string }[];
};

/** The first value `record` has at `f` (deep, as the build merges objects and texts) that `value` lacks. */
function lacking(record: unknown, value: unknown, f: string): string | null {
	if (value === undefined) return record === undefined ? null : f;
	if (!isObj(record) || !isObj(value)) return null;
	for (const [k, sub] of Object.entries(record)) {
		const missing = lacking(sub, value[k], `${f}.${k}`);
		if (missing) return missing;
	}
	return null;
}

/** The ops that turn one copy into `{ use }` (a stop `{ at }`) plus the fields where it differs from `record`. */
function convertOps(copy: Copy, e: Entry, id: string, record: Entry): FieldOp[] {
	const scope = copy.doc.sidecar ? 'hike' : 'post';
	const at = pathOf(copy);
	const keep = Object.keys(e).filter((f) => f !== 'at' && canonical(e[f]) !== canonical(record[f]));
	const ops: FieldOp[] = [];
	// `use` first: the entry never goes empty on the way.
	if (copy.kind !== 'stops' && copy.entry.use !== id) ops.push({ kind: 'facts', scope, path: [...at, 'use'], value: id });
	for (const f of keep) if (!Object.hasOwn(copy.entry, f)) ops.push({ kind: 'facts', scope, path: [...at, f], value: e[f] });
	for (const f of Object.keys(copy.entry)) {
		if (f === 'use' || f === 'at' || keep.includes(f)) continue;
		ops.push({ kind: 'facts', scope, path: [...at, f], remove: true });
	}
	return ops;
}

const docRef = (doc: Doc): { slug: string; date: string | null } => {
	if (doc.sidecar) return { slug: doc.name.slice(0, -'.hike.json'.length), date: null };
	const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(doc.name)!;
	return { slug: m[2], date: m[1] };
};

/** The doc's `facts` after `ops`, as `readDocFacts` takes a draft. */
function factsAfter(root: string, doc: Doc, ops: FieldOp[]): unknown {
	const { slug, date } = docRef(doc);
	const facts = clientDoc(applyOps(loadDoc(root, slug, date), ops)).facts;
	return doc.sidecar ? facts.hike : facts.post;
}

/** The pages a merge reads before writing: those of the touched hikes, or for a stop record every page (a stop takes it by its place). */
export function pagesToCheck(root: string, kind: LibraryKind, slugs: Set<string>): ReturnType<typeof factsDocs> {
	return factsDocs(root).filter((page) => kind === 'stops' || slugs.has(page.ref.slug));
}

/**
 * Merges the group `group` into the record `id` made from the chosen entry; answers what was written. Nothing is
 * written when the group, the entry or the id is wrong (400), when any page would read differently (400), or when the
 * library changed meanwhile (409, StaleLibraryError).
 */
export async function mergeNearDuplicates(root: string, req: MergeRequest): Promise<MergeResult> {
	const base = libraryVersion(root);
	const library = libraryOf(root);
	const group = groupsOf(readCopies(readDocs(root), library), library).find((g) => g.id === req.group);
	if (!group) throw new ApiError(400, `no near-duplicate group ${req.group}`);
	const kind = group.kind;
	const chosen = group.members.find(({ copy }) => copy.doc.name === req.chosen?.file && pathText(copy) === req.chosen?.path);
	if (!chosen) throw new ApiError(400, `the chosen entry is not one of the group's`);
	const id = req.id;
	if (kind === 'stops' ? id !== chosen.copy.ref || !REF_RE.test(id) : !LIBRARY_ID_RE.test(id))
		throw new ApiError(400, kind === 'stops' ? `a stop's record is keyed by its place: ${chosen.copy.ref}` : 'an id is lowercase words joined by "-"');
	const record = chosen.e;
	// A record of that id is replaced only when no hike outside the group takes it and those in it would read the same
	// (a retry of a merge that stopped part way); one no hike takes is replaced as well.
	if (kind !== 'stops' && Object.hasOwn(library[kind], id)) {
		const ours = new Set(group.members.map(({ copy }) => docRef(copy.doc).slug));
		const users = (libraryState(root).usage[`${kind}/${id}`] ?? []).map((name) => name.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
		const same = canonical((library[kind] as Record<string, unknown>)[id]) === canonical(record);
		if (users.some((slug) => !ours.has(slug)) || (users.length && !same)) throw new ApiError(400, `"${id}" is taken`);
	}
	try {
		validateLibraryRecord(kind, id, record, 'facts-library.json');
	} catch (e) {
		if (e instanceof FactsError) throw new ApiError(400, e.message);
		throw e;
	}

	// Which entries convert, and each file's ops.
	const kept: MergeResult['kept'] = [];
	const plans = new Map<Doc, { copy: Copy; ops: FieldOp[] }[]>();
	for (const { copy, e } of group.members) {
		const missing = Object.keys(record).map((f) => lacking(record[f], e[f], f)).find(Boolean);
		if (missing) {
			kept.push({ file: copy.doc.name, path: pathText(copy), reason: `kept: has no ${missing}` });
			continue;
		}
		const ops = convertOps(copy, e, id, record);
		// Converted already (a retry): nothing to write.
		if (ops.length) plans.set(copy.doc, [...(plans.get(copy.doc) ?? []), { copy, ops }]);
	}

	// Every page that reads a touched file (pagesToCheck) must read the same with the new record.
	const trial = structuredClone(library);
	(trial[kind] as Record<string, unknown>)[id] = record;
	const drafts = new Map<string, unknown>();
	for (const [doc, plan] of plans) drafts.set(doc.name, factsAfter(root, doc, plan.flatMap((p) => p.ops)));
	const slugs = new Set([...plans.keys()].map((d) => docRef(d).slug));
	const changed: string[] = [];
	for (const page of pagesToCheck(root, kind, slugs)) {
		const ref = page.ref as Extract<DocRef, { kind: 'post' | 'hike' }>;
		const draft = {
			hike: drafts.get(`${ref.slug}.hike.json`),
			post: ref.kind === 'post' ? drafts.get(`${ref.date}-${ref.slug}.md`) : undefined
		};
		const read = (r: ReturnType<typeof readDocFacts>) => canonical([r.facts, r.error]);
		if (read(readDocFacts(root, ref)) !== read(readDocFacts(root, ref, { draft, library: trial }))) changed.push(page.name);
	}
	if (changed.length) throw new ApiError(400, `the merge would change ${changed.join(', ')}; nothing was written`);

	await putLibraryRecord(root, kind, id, record, base);
	const files: MergeResult['files'] = [...plans.keys()].map((d) => ({ file: d.name, status: 'not written' }));
	for (const [i, [doc, plan]] of [...plans].entries()) {
		const { slug, date } = docRef(doc);
		try {
			await withDocLock(lockKey(date ? { kind: 'post', slug, date } : { kind: 'hike', slug }), () => {
				// Loaded fresh: each entry must still be the one grouped, then it is saved on this version.
				const cur = loadDoc(root, slug, date);
				const facts = clientDoc(cur).facts;
				const now = doc.sidecar ? facts.hike : facts.post;
				if (plan.some(({ copy }) => canonical(getIn(now, pathOf(copy))) !== canonical(copy.entry))) throw new ApiError(409, 'changed on disk since the groups were read');
				const r = saveOps(root, slug, date, cur.version, plan.flatMap((p) => p.ops));
				if (!r.ok) throw new ApiError(409, 'changed on disk');
			});
			files[i] = { file: doc.name, status: 'saved' };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			files[i] = { file: doc.name, status: 'failed', error: message };
			return { ok: false, error: `${doc.name}: ${message}; the files before it are written`, library: 'written', files, kept };
		}
	}
	return { ok: true, library: 'written', files, kept };
}

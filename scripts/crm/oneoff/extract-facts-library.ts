// One-off: move the facts blocks repeated across hikes into the shared library
// (static/_projects/data-viz/hikes/facts-library.json). Idempotent. Run with:
//   JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti scripts/crm/oneoff/extract-facts-library.ts [--dry-run]
//
// An entry of a library kind (`stops`, `access.transport`, `access.lifts`,
// `access.parking`, `access.tickets`) that two or more documents (sidecars or
// posts) hold byte-identically, key order aside, becomes one record:
// - a stop is keyed by the OSM ref its `at` resolves to, and each copy becomes
//   `{ at }` with the author's spelling; a stop whose `at` resolves to no ref,
//   or to different refs on different posts, stays inline;
// - the other kinds get an id (transport `<mode>-<line or from>-<to>`, the
//   others their English `name`, else `at`, slugified; `-2`, `-3` on a clash),
//   and each copy becomes `{ use: "<id>" }`.
// Every copy is checked before anything is written: the build's facts reader
// must give the same facts (key order aside) with the record as inline, and
// so must every post's whole facts with the new library.
//
// Entries whose key matches but whose content differs (stops by OSM ref,
// transport by mode/from/to/line, lifts and tickets by name, parking by name
// and at) are near-duplicates (grouped by lib/facts-near-duplicates.ts, which
// the Facts tab reads them fresh with): printed, and written to
// scripts/crm/data/near-duplicates.json.
//
// Sidecars are edited as text, so every byte outside the converted entries
// stays; posts through lib/frontmatter.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { isMap, type Document } from 'yaml';
import { readHikeFacts, type ReadFactsInput } from '$lib/hikes/facts.server';
import { emptyFactsLibrary, LIBRARY_KINDS, type FactsLibrary } from '$lib/hikes/facts-library.server';
import { parseFactsLibrary, serializeFactsLibrary, writeFactsLibrary } from '../lib/facts-library-file';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { repoPaths } from '../server/paths';
import { lineIndent } from '../server/sidecar-file';
import { baseId, recordId } from '../shared/library-id';
import {
	canonical, getIn, lone, nearDuplicates, pathOf, pathText, postFacts, readCopies, readDocs,
	type Copy, type Doc, type Entry, type Key, type NearDuplicateGroup
} from '../lib/facts-near-duplicates';

export type { NearDuplicateGroup };

export interface LibraryResult {
	records: number;
	/** Copies turned into a reference to a record. */
	references: number;
	nearDuplicates: NearDuplicateGroup[];
	/** Repeated entries left inline, with the reason. */
	notConverted: string[];
	/** The files rewritten (or that a dry run would rewrite), the library included. */
	files: string[];
}

/** The facts reader on one context: `own` from the doc, `other` its partner. */
function factsOf(doc: Doc, at: number, own: Entry | undefined, other: Entry | undefined, library: FactsLibrary): string {
	const ctx = doc.contexts[at];
	const input: ReadFactsInput = { ...ctx, sidecar: doc.sidecar ? own : other, post: doc.sidecar ? other : own, library };
	return canonical(readHikeFacts(input).facts);
}

/** The sidecar's text with each converted entry's own text replaced; every other byte stays. */
function spliceSidecar(raw: string, edits: { path: Key[]; entry: Entry; keepAt: boolean }[]): string {
	const root = parseTree(raw)!;
	const spans = edits.map(({ path, entry, keepAt }) => {
		const node = findNodeAtLocation(root, ['facts', ...path])!;
		const atNode = keepAt ? findNodeAtLocation(node, ['at']) : undefined;
		const value = atNode ? raw.slice(atNode.offset, atNode.offset + atNode.length) : JSON.stringify(entry.use);
		const member = `${JSON.stringify(keepAt ? 'at' : 'use')}: ${value}`;
		const own = raw.slice(node.offset, node.offset + node.length);
		const firstKey = node.children?.[0];
		const text = !own.includes('\n') || !firstKey
			? `{ ${member} }`
			: `{\n${lineIndent(raw, firstKey.offset)}${member}\n${lineIndent(raw, node.offset)}}`;
		return { from: node.offset, to: node.offset + node.length, text };
	});
	let out = raw;
	for (const s of spans.sort((a, b) => b.from - a.from)) out = out.slice(0, s.from) + s.text + out.slice(s.to);
	return out;
}

/** The post's text with each converted entry cut down to its `at`, or replaced by its `use`, through the front-matter writer. */
function editPost(raw: string, edits: { path: Key[]; entry: Entry; keepAt: boolean }[]): string {
	const { doc, body } = readFrontmatterDoc(raw);
	for (const { path, entry, keepAt } of edits) {
		const item = (doc as Document).getIn(['facts', ...path], true);
		if (!isMap(item)) throw new Error(`facts.${path.join('.')} is not a mapping`);
		for (const pair of [...item.items]) {
			const key = (pair.key as { value?: unknown })?.value ?? pair.key;
			if (!(keepAt && key === 'at')) item.delete(key);
		}
		if (!keepAt) item.set('use', entry.use);
	}
	return writeFrontmatterDoc(doc, body);
}

/** Moves the repeated facts entries under `root` into its library; with `dryRun`, only reports. */
export function extractLibrary(root: string, { dryRun = false }: { dryRun?: boolean } = {}): LibraryResult {
	const p = repoPaths(root);
	const oldLibrary = existsSync(p.factsLibrary) ? parseFactsLibrary(readFileSync(p.factsLibrary, 'utf8')) : emptyFactsLibrary();
	const docs = readDocs(root);

	const copies = readCopies(docs, oldLibrary);

	// Byte-identical entries (key order aside) of one kind, in two or more documents.
	const groups = new Map<string, Copy[]>();
	for (const c of copies) {
		if (c.linked) continue;
		const id = `${c.kind}|${canonical(c.entry)}`;
		groups.set(id, [...(groups.get(id) ?? []), c]);
	}
	const library = structuredClone(oldLibrary);
	const notConverted: string[] = [];
	const converted: { copy: Copy; entry: Entry; keepAt: boolean }[] = [];
	const where = (c: Copy) => `${c.doc.name} ${pathText(c)}`;
	for (const group of groups.values()) {
		if (new Set(group.map((c) => c.doc)).size < 2) continue;
		const [first] = group;
		const kind = first.kind;
		const what = `${kind} "${baseId(kind, first.entry)}" (${group.map(where).join(', ')})`;
		let id: string;
		let record: Entry;
		if (kind === 'stops') {
			const refs = new Set(group.map((c) => c.ref));
			if (refs.size !== 1 || !first.ref) {
				notConverted.push(`${what}: its at resolves to no OSM ref, or to different ones`);
				continue;
			}
			// Another stop at the same place would take this record's fields as well.
			const other = copies.find((c) => c.kind === 'stops' && c.ref === first.ref && !group.includes(c));
			if (other) {
				notConverted.push(`${what}: ${where(other)} is a different stop at the same place`);
				continue;
			}
			id = first.ref;
			const { at: _, ...rest } = first.entry;
			record = rest;
		} else {
			const taken = library[kind] as Record<string, unknown>;
			id = recordId(kind, first.entry, taken);
			record = first.entry;
		}
		const trial = structuredClone(library);
		(trial[kind] as Record<string, unknown>)[id] = record;
		const checked = parseFactsLibrary(serializeFactsLibrary(trial));
		// Each copy: the record must give back exactly the entry.
		const ref: Entry = kind === 'stops' ? { at: first.entry.at } : { use: id };
		const broken = group.find((c) =>
			c.doc.contexts.some((_, i) => factsOf(c.doc, i, lone(kind, ref), undefined, checked) !== factsOf(c.doc, i, lone(kind, c.entry), undefined, oldLibrary))
		);
		if (broken) {
			notConverted.push(`${what}: ${where(broken)} reads differently from the record`);
			continue;
		}
		(library[kind] as Record<string, unknown>)[id] = record;
		for (const c of group) converted.push({ copy: c, entry: kind === 'stops' ? { at: c.entry.at } : { use: id }, keepAt: kind === 'stops' });
	}

	// The new texts, each read back, then every post's whole facts checked against the new library.
	const finalLibrary = parseFactsLibrary(serializeFactsLibrary(library));
	const texts = new Map<Doc, string>();
	const newFacts = new Map<Doc, Entry>();
	for (const doc of docs) {
		const edits = converted.filter((c) => c.copy.doc === doc).map((c) => ({ path: pathOf(c.copy), entry: c.entry, keepAt: c.keepAt }));
		if (!edits.length) continue;
		const expected = structuredClone(doc.facts);
		for (const e of edits) (getIn(expected, e.path.slice(0, -1)) as Entry[])[e.path.at(-1) as number] = e.entry;
		const text = doc.sidecar ? spliceSidecar(doc.raw, edits) : editPost(doc.raw, edits);
		const after = (doc.sidecar ? (JSON.parse(text) as Entry).facts : postFacts(text)) as Entry;
		if (canonical(after) !== canonical(expected)) throw new Error(`${doc.name}: the written file does not read back as the converted facts`);
		// Nothing outside `facts` changes: the sidecar's other fields, the post's other front matter and its body.
		const outside = (raw: string): unknown => {
			if (doc.sidecar) return { ...(JSON.parse(raw) as Entry), facts: undefined };
			const { doc: front, body } = readFrontmatterDoc(raw);
			return { ...(front.toJS() as Entry), facts: undefined, body };
		};
		if (canonical(outside(text)) !== canonical(outside(doc.raw))) throw new Error(`${doc.name}: something outside facts changed`);
		texts.set(doc, text);
		newFacts.set(doc, after);
	}
	const factsNow = (doc: Doc) => newFacts.get(doc) ?? doc.facts;
	const partnerDoc = (doc: Doc, i: number) =>
		docs.find((d) => d.sidecar !== doc.sidecar && (doc.sidecar ? d.contexts[0].postSource === doc.contexts[i].postSource : d.name === doc.contexts[0].sidecarSource));
	for (const doc of docs) {
		for (const i of doc.contexts.keys()) {
			const partner = partnerDoc(doc, i);
			const before = factsOf(doc, i, doc.facts, doc.partners[i], oldLibrary);
			const now = factsOf(doc, i, factsNow(doc), partner ? factsNow(partner) : doc.partners[i], finalLibrary);
			if (before !== now) throw new Error(`${doc.contexts[i].postSource}: its facts read differently with the library`);
		}
	}

	const files = [...texts.keys()].map((d) => d.name);
	const libraryText = serializeFactsLibrary(finalLibrary);
	const libraryChanged = !existsSync(p.factsLibrary) || readFileSync(p.factsLibrary, 'utf8') !== libraryText;
	if (libraryChanged && converted.length) files.push('facts-library.json');

	// Near-duplicates, as the entries read now.
	const after = copies.map((c) => {
		const conv = converted.find((x) => x.copy === c);
		return conv ? { ...c, entry: conv.entry, linked: true } : c;
	});
	const near = nearDuplicates(after, finalLibrary);

	if (!dryRun) {
		for (const [doc, text] of texts) writeFileSync(doc.file, text, 'utf8');
		if (libraryChanged && converted.length) writeFactsLibrary(root, finalLibrary);
		mkdirSync(p.crmData, { recursive: true });
		writeFileSync(path.join(p.crmData, 'near-duplicates.json'), JSON.stringify(near, null, '\t') + '\n', 'utf8');
	}
	const records = LIBRARY_KINDS.reduce((n, k) => n + Object.keys(finalLibrary[k]).length - Object.keys(oldLibrary[k]).length, 0);
	return { records, references: converted.length, nearDuplicates: near, notConverted, files };
}

function main(): void {
	const dryRun = process.argv.includes('--dry-run');
	const root = fileURLToPath(new URL('../../../', import.meta.url));
	const r = extractLibrary(root, { dryRun });
	for (const f of r.files) console.log(`${f}: changed`);
	console.log(`${dryRun ? '[dry run] ' : ''}extract-facts-library: ${r.records} records, ${r.references} references, ${r.files.length} files changed`);
	if (r.notConverted.length) console.log(`not converted (${r.notConverted.length}):\n${r.notConverted.map((n) => `  ${n}`).join('\n')}`);
	console.log(`near-duplicates (${r.nearDuplicates.length} groups)${dryRun ? '' : ', written to scripts/crm/data/near-duplicates.json'}:`);
	for (const g of r.nearDuplicates) {
		console.log(`  ${g.kind} ${g.key}`);
		for (const e of g.entries) console.log(`    ${e.file} ${e.path}: ${e.diff.join('; ')}`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

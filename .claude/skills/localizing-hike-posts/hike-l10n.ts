// Headless helpers for the "localizing-hike-posts" skill. They reuse the hike CRM's own code: the facts reader,
// the library writer, the sidecar minimal-edit writer, the Fill gatherers and the DeepL client. Run from the repo root:
//
//   JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti .claude/skills/localizing-hike-posts/hike-l10n.ts <command> …
//
// Commands:
//   move <slug> <kind>:<index>[=<id>] … [--dry-run]
//       Moves sidecar facts entries into facts-library.json. kind: stops|transport|lifts|parking|tickets, index: the
//       entry's position in that list. A stop is keyed by its `at.ref` (no id); the others need `=<id>`. The entry
//       becomes `{ "at": … }` / `{ "use": "<id>" }`. Refused, nothing written, if any page's resolved facts change
//       or the id exists already.
//   fill <slug> <lang>… [--dry-run]
//       "Fill empty from English" for one hike, like the CRM's buttons: the sidecar's facts, its name and
//       description, every library record the hike uses, and the post translation(s) `<date>-<slug>.<lang>.md`
//       (created when missing). Only empty translations are filled; nothing is overwritten. CRM_DEEPL_STUB=1: no key,
//       no request, texts come back as `⟨de⟩ …`.
//   texts <slug> <lang>
//       Prints every translated text of the hike (sidecar, used library records) as `path\ten\t<lang>` for proofreading.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document } from 'yaml';
import { readHikeFacts } from '$lib/hikes/facts.server';
import { LIBRARY_KINDS, type FactsLibrary, type LibraryKind } from '$lib/hikes/facts-library.server';
import { isLang, type Lang } from '$lib/i18n/languages';
import { parseFactsLibrary, serializeFactsLibrary } from '../../../scripts/crm/lib/facts-library-file';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../../../scripts/crm/lib/frontmatter';
import { canonical, readDocs, type Doc, type Entry } from '../../../scripts/crm/lib/facts-near-duplicates';
import { LIST_PATHS } from '../../../scripts/crm/shared/library-id';
import { at } from '../../../scripts/crm/shared/tree';
import { editSidecar, type SidecarEdit } from '../../../scripts/crm/server/sidecar-file';
import { repoPaths } from '../../../scripts/crm/server/paths';
import { loadSettings } from '../../../scripts/crm/server/settings';
import { deeplLangs, deeplStub, translateBatch } from '../../../scripts/crm/server/deepl';
import { applyFill, gatherDoc, gatherFacts, gatherRecord, gatherRoute, type FillItem } from '../../../scripts/crm/web/fill/fill';
import { textParts } from '../../../scripts/crm/web/facts/form-model';

const root = process.cwd();
const P = repoPaths(root);
const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const die = (msg: string): never => {
	console.error(msg);
	process.exit(1);
};
const isObj = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

const sidecarFile = (slug: string) => path.join(P.markdown, `${slug}.hike.json`);
const postFiles = (slug: string) =>
	readdirSync(P.markdown)
		.filter((f) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${slug}\\.md$`).test(f))
		.map((f) => path.join(P.markdown, f));
const readLibrary = () => parseFactsLibrary(readFileSync(P.factsLibrary, 'utf8'));

/** The resolved facts of every page of `slug` (the build's reader), canonical, for before/after comparison. */
function pages(slug: string, library: FactsLibrary, sidecarFacts?: Entry): string[] {
	const docs = readDocs(root).filter((d: Doc) => d.sidecar && d.name === `${slug}.hike.json`);
	if (!docs.length) die(`no sidecar with facts: ${slug}.hike.json`);
	const d = docs[0];
	return d.contexts.map((ctx, i) => canonical(readHikeFacts({ ...ctx, sidecar: sidecarFacts ?? d.facts, post: d.partners[i], library }).facts));
}

/** The library records a hike's facts use: stops by `at.ref`, the rest by `use`. */
function usedRecords(facts: Entry, library: FactsLibrary): { kind: LibraryKind; id: string }[] {
	const out: { kind: LibraryKind; id: string }[] = [];
	for (const kind of LIBRARY_KINDS) {
		const list = at(facts, LIST_PATHS[kind]);
		if (!Array.isArray(list)) continue;
		for (const e of list) {
			if (!isObj(e)) continue;
			const id = kind === 'stops' ? (isObj(e.at) ? (e.at.ref as string | undefined) : undefined) : (e.use as string | undefined);
			if (id && (library[kind] as Record<string, unknown>)[id]) out.push({ kind, id });
		}
	}
	return out;
}

function move(slug: string, specs: string[]) {
	const file = sidecarFile(slug);
	const raw = readFileSync(file, 'utf8');
	const facts = (JSON.parse(raw) as Entry).facts as Entry;
	const library = readLibrary();
	const before = pages(slug, library);
	const next = structuredClone(library) as FactsLibrary;
	const newFacts = structuredClone(facts);
	const edits: SidecarEdit[] = [];
	for (const spec of specs) {
		const m = /^(\w+):(\d+)(?:=([a-z0-9-]+))?$/.exec(spec) ?? die(`bad spec "${spec}": kind:index[=id]`);
		const kind = m[1] as LibraryKind;
		if (!LIBRARY_KINDS.includes(kind)) die(`unknown kind ${kind}`);
		const listPath = LIST_PATHS[kind];
		const entry = at(facts, [...listPath, Number(m[2])]);
		if (!isObj(entry)) die(`${spec}: no entry at facts.${listPath.join('.')}[${m[2]}]`);
		if ('use' in entry) die(`${spec}: already uses "${entry.use}"`);
		const record = structuredClone(entry);
		let id: string;
		let replacement: Entry;
		if (kind === 'stops') {
			const ref = isObj(entry.at) ? entry.at.ref : undefined;
			if (typeof ref !== 'string') die(`${spec}: a stop needs at: { ref } to be keyed`);
			id = ref as string;
			delete record.at;
			replacement = { at: entry.at };
		} else {
			id = m[3] ?? die(`${spec}: needs =<id> (lowercase words joined by -)`);
			replacement = { use: id };
		}
		if ((next[kind] as Record<string, unknown>)[id]) die(`${spec}: library ${kind} "${id}" exists already`);
		(next[kind] as Record<string, unknown>)[id] = record;
		const p = [...listPath, Number(m[2])];
		(at(newFacts, listPath) as unknown[])[Number(m[2])] = replacement;
		edits.push({ path: ['facts', ...p], value: replacement });
		console.log(`${spec}: facts.${p.join('.')} → library ${kind} "${id}"`);
	}
	const text = serializeFactsLibrary(next);
	const reread = parseFactsLibrary(text);
	const after = pages(slug, reread, newFacts);
	if (after.some((a, i) => a !== before[i])) die('refused: the resolved facts of a page would change');
	console.log('resolved facts unchanged on every page');
	if (dryRun) return;
	writeFileSync(P.factsLibrary, text);
	writeFileSync(file, editSidecar(raw, edits));
	console.log(`wrote ${path.relative(root, P.factsLibrary)} and ${path.relative(root, file)}`);
}

async function translate<S>(lang: Lang, items: FillItem<S>[], current: S, what: string): Promise<{ state: S; applied: string[] }> {
	if (!items.length) return { state: current, applied: [] };
	const stub = process.env.CRM_DEEPL_STUB === '1';
	const key = stub ? 'stub' : (loadSettings(root).deeplKey ?? die('no DeepL key: deeplKey in scripts/crm/data/settings.json or DEEPL_API_KEY'));
	const res = await translateBatch(
		items.map(({ id, text, kind }) => ({ id, text, kind })),
		lang,
		{ key, fetch: stub ? deeplStub : fetch }
	);
	for (const r of res.refused) console.warn(`  ${what}: REFUSED ${items.find((i) => i.id === r.id)?.label}: ${r.reason}`);
	const { state, applied, skipped } = applyFill(items, res.texts, current);
	if (skipped.length) console.warn(`  ${what}: skipped ${skipped.length} (target not empty any more)`);
	console.log(`  ${what}: ${applied.length}/${items.length} filled`);
	return { state, applied };
}

async function fill(slug: string, langs: Lang[]) {
	const file = sidecarFile(slug);
	for (const lang of langs) {
		console.log(`${lang}:`);
		// sidecar facts + route words
		let raw = readFileSync(file, 'utf8');
		const side = JSON.parse(raw) as Entry;
		const facts = side.facts as Entry;
		const items = gatherFacts(facts, lang);
		const { state, applied } = await translate(lang, items, facts as unknown, 'sidecar facts');
		const edits: SidecarEdit[] = [];
		for (const id of applied) {
			const item = items.find((i) => i.id === id)!;
			const p = item.commitPath ?? (JSON.parse(id) as (string | number)[]);
			edits.push({ path: ['facts', ...p], value: at(state, p) });
		}
		const texts: Record<string, Record<string, string>> = {};
		for (const f of ['name', 'description']) if (side[f] != null) texts[`sidecar.${f}`] = textParts(side[f]);
		const route = await translate(lang, gatherRoute(texts, lang), texts, 'name/description');
		for (const id of route.applied) edits.push({ path: [id.slice('sidecar.'.length)], value: route.state[id] });
		raw = editSidecar(raw, edits);
		JSON.parse(raw);
		if (!dryRun && edits.length) writeFileSync(file, raw);

		// library records the hike uses
		const library = readLibrary();
		let changed = false;
		for (const { kind, id } of usedRecords(facts, library)) {
			const rec = (library[kind] as Record<string, unknown>)[id];
			const its = gatherRecord(rec, lang, kind);
			const r = await translate(lang, its, rec, `library ${kind} ${id}`);
			if (r.applied.length) {
				(library[kind] as Record<string, unknown>)[id] = r.state;
				changed = true;
			}
		}
		if (changed && !dryRun) writeFileSync(P.factsLibrary, serializeFactsLibrary(parseFactsLibrary(serializeFactsLibrary(library))));

		// post translation(s)
		for (const post of postFiles(slug)) {
			const en = readFrontmatterDoc(readFileSync(post, 'utf8'));
			const enFields = (en.doc.toJS() ?? {}) as Entry;
			const target = post.replace(/\.md$/, `.${lang}.md`);
			const tr = readFrontmatterDoc(existsSync(target) ? readFileSync(target, 'utf8') : '---\n---\n');
			const trFields = (tr.doc.toJS() ?? {}) as Entry;
			const its = gatherDoc(en.body, tr.body, trFields, enFields);
			const cur = { en: en.body, body: tr.body, title: String(trFields.title ?? ''), description: String(trFields.description ?? '') };
			const r = await translate(lang, its, cur, path.basename(target));
			if (!r.applied.length || dryRun) continue;
			const doc = existsSync(target) ? tr.doc : new Document({});
			for (const f of ['title', 'description'] as const) if (r.state[f].trim()) doc.set(f, r.state[f]);
			writeFileSync(target, writeFrontmatterDoc(doc, r.state.body));
		}
	}
}

function texts(slug: string, lang: Lang) {
	const side = JSON.parse(readFileSync(sidecarFile(slug), 'utf8')) as Entry;
	const walk = (v: unknown, p: string) => {
		if (isObj(v) && typeof v.en === 'string' && Object.values(v).every((x) => typeof x === 'string')) {
			console.log(`${p}\t${v.en}\t${(v as Record<string, string>)[lang] ?? '(MISSING)'}`);
		} else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
		else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
	};
	walk({ name: side.name, description: side.description }, '');
	walk(side.facts, 'facts');
	const library = readLibrary();
	for (const { kind, id } of usedRecords(side.facts as Entry, library)) walk((library[kind] as Record<string, unknown>)[id], `library.${kind}.${id}`);
}

const [cmd, slug, ...rest] = args;
if (!cmd || !slug) die('usage: move <slug> <kind>:<index>[=<id>]… | fill <slug> <lang>… | texts <slug> <lang>  [--dry-run]');
if (!existsSync(sidecarFile(slug))) die(`no ${slug}.hike.json`);
const langsOf = (xs: string[]) => {
	for (const l of xs) if (!isLang(l) || !deeplLangs().includes(l)) die(`not a DeepL language here: ${l} (${deeplLangs().join(', ')})`);
	return xs as Lang[];
};
if (cmd === 'move') move(slug, rest);
else if (cmd === 'fill') await fill(slug, langsOf(rest));
else if (cmd === 'texts') texts(slug, langsOf(rest)[0]);
else die(`unknown command ${cmd}`);

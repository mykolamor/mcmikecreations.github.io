import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { loadHikesFrom } from '../../load-hikes.js';
import { REF_RE, resolveRef } from '../../../src/lib/data/osm-store.js';
import { englishText } from '../../../src/lib/data/hikes-core.js';
import { LIBRARY_KINDS, RECORD_NAMES, type FactsLibrary, type LibraryKind } from '../../../src/lib/hikes/facts-library.server';
import { readFactsLibraryFile } from '../lib/facts-library-file';
import { factsDocs, readDocFacts, watchedLibrary } from './facts-read';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { postPath, sidecarPath } from './doc';
import { docFile, type DocRef } from './doc-ref';
import type { TranslationRef } from './translation-doc';
import { ApiError } from './errors';
import { collectTranslations } from '../../../src/lib/hikes/translations.server';
import { readFrontmatterDoc } from '../lib/frontmatter';

/** `file` (repo-relative) names where a store-wide problem is; a hike's own problems leave it out. */
export type Problem = { level: 'error' | 'warning' | 'site'; message: string; file?: string };

const REQUIRED = ['name', 'description', 'image', 'origin', 'height', 'checkpoints'];

const missing = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** What would stop the hike (or this post) from building or rendering, read from `root`. */
export function problemsFor(root: string, slug: string, date: string | null): Problem[] {
	assertSafeSlug(slug);
	return problemsForRef(root, date ? { kind: 'post', slug, date: assertSafeDate(date) } : { kind: 'hike', slug });
}

/**
 * What would stop the doc from building or rendering, read from `root`: a hike's or post's (as problemsFor), or a
 * translation's, as `crm check` reads it. A place doc has none listed here.
 */
export function problemsForRef(root: string, ref: DocRef): Problem[] {
	if (ref.kind === 'translation') return translationProblems(root, ref);
	if (ref.kind === 'place') throw new ApiError(400, 'Not available for a place doc');
	const { slug } = ref;
	const date = ref.kind === 'post' ? ref.date : null;
	const p = repoPaths(root);
	const out: Problem[] = [];
	const sp = sidecarPath(root, slug);
	if (!existsSync(sp)) return [{ level: 'error', message: `No sidecar for ${slug}` }];
	const sidecar = parse(readFileSync(sp, 'utf8')) ?? {};
	for (const k of REQUIRED) if (missing(sidecar[k])) out.push({ level: 'error', message: `Sidecar is missing "${k}"` });
	if (date && !existsSync(postPath(root, slug, date))) out.push({ level: 'error', message: `No post file for ${date}` });
	if (!existsSync(path.join(p.geojson, `${slug}.json`))) out.push({ level: 'warning', message: `No GeoJSON route file (${slug}.json)` });
	try {
		loadHikesFrom(p.static, p.hikesJson, { fresh: true });
	} catch (e) {
		out.push({ level: 'site', message: `Site build (any hike): ${e instanceof Error ? e.message : String(e)}` });
	}
	// The facts as the page reads them: what would fail the build, and what it only warns about.
	try {
		const facts = readDocFacts(root, ref);
		if (facts.error !== null) out.push({ level: 'error', message: facts.error });
		for (const message of facts.warnings) out.push({ level: 'warning', message });
	} catch (e) {
		// Unreadable front matter or library: the doc routes and the library check say so; the facts can't be read.
		out.push({ level: 'error', message: `Facts not read: ${e instanceof Error ? e.message : String(e)}` });
	}
	return out;
}

/**
 * A translation's problems, one at a time as `crm check` gives them: what the site refuses in it (its keys and texts),
 * else its source gone, else the first photo or clip it shows that isn't there. One not made yet has only the missing
 * source. Front matter the CRM can't split off (CRLF) is a warning of its own: the site reads it.
 */
function translationProblems(root: string, ref: TranslationRef): Problem[] {
	const file = docFile(root, ref)!;
	const name = path.basename(file);
	const sourceFile = docFile(root, ref.source)!;
	const source = path.basename(sourceFile);
	const hasSource = existsSync(sourceFile);
	if (!existsSync(file)) return hasSource ? [] : [{ level: 'error', message: `Translation ${name}: no ${source} beside it to translate` }];
	const raw = readFileSync(file, 'utf8');
	const out: Problem[] = [];
	try {
		collectTranslations(ref.source.kind, { [name]: raw }, new Set(hasSource ? [source] : []), { root });
	} catch (e) {
		out.push({ level: 'error', message: e instanceof Error ? e.message : String(e) });
	}
	try {
		readFrontmatterDoc(raw);
	} catch (e) {
		const message = /^---\r\n/.test(raw) ? "CRLF front matter: the CRM can't edit it" : `Front matter not readable: ${e instanceof Error ? e.message : String(e)}`;
		out.push({ level: 'warning', message });
	}
	return out;
}

/** Hike names by the store ids their sidecar `nodes` list: the built hikes when they load, else the raw sidecars. */
function hikesByRef(root: string, sidecars: { name: unknown; nodes: string[] }[]): Map<string, Set<string>> {
	const p = repoPaths(root);
	let hikes: { name: unknown; nodes: string[] }[] = sidecars;
	try {
		hikes = loadHikesFrom(p.static, p.hikesJson, { fresh: true }).map((h: any) => ({ name: h.name, nodes: (h.properties?.nodes ?? []).map((n: any) => n.ref) }));
	} catch {
		/* a missing ref (reported below) or another build error: name them from the sidecars */
	}
	const out = new Map<string, Set<string>>();
	for (const h of hikes) for (const ref of h.nodes) (out.get(ref) ?? out.set(ref, new Set()).get(ref)!).add(String(h.name));
	return out;
}

/**
 * Problems of the shared OSM store (port of the former scripts/check-nodes.js): as warnings, elements sharing a
 * lat/lon, a name or a wikidata id (the second one found, naming the first); as errors, sidecar `nodes` ids the
 * store doesn't have.
 */
export function storeProblems(root: string): Problem[] {
	const p = repoPaths(root);
	const warnings: Problem[] = [];
	const errors: Problem[] = [];
	const storeFile = path.relative(root, p.osmStore);
	const store = existsSync(p.osmStore) ? JSON.parse(readFileSync(p.osmStore, 'utf8')) : {};
	const sidecars: { name: unknown; nodes: string[] }[] = [];
	const files = existsSync(p.markdown) ? readdirSync(p.markdown).filter((f) => f.endsWith('.hike.json')).sort() : [];
	for (const f of files) {
		const file = path.join(p.markdown, f);
		const sidecar = parse(readFileSync(file, 'utf8')) ?? {};
		const nodes: string[] = Array.isArray(sidecar.nodes) ? sidecar.nodes.map(String) : [];
		for (const ref of nodes) {
			if (!REF_RE.test(ref) || !store[ref]) errors.push({ level: 'error', file: path.relative(root, file), message: `unknown OSM element ${ref}` });
		}
		sidecars.push({ name: englishText(sidecar.name), nodes });
	}

	const byRef = hikesByRef(root, sidecars);
	const hikesOf = (ref: string) => [...(byRef.get(ref) ?? [])].join(', ') || 'no hike (photo pins only)';
	const seen = { 'lat/lon': new Map<string, string>(), name: new Map<string, string>(), wikidata: new Map<string, string>() };
	const dup = (label: keyof typeof seen, key: string, ref: string) => {
		const other = seen[label].get(key);
		if (other === undefined) seen[label].set(key, ref);
		else warnings.push({ level: 'warning', file: storeFile, message: `Duplicate ${label}: ${key} for: ${ref} ${other} (${ref} in: ${hikesOf(ref)}; ${other} in: ${hikesOf(other)})` });
	};
	for (const ref of Object.keys(store)) {
		const node = resolveRef(ref, store, storeFile);
		dup('lat/lon', `${node.lat},${node.lon}`, ref);
		if (node.tags?.name) dup('name', node.tags.name, ref);
		if (node.tags?.wikidata) dup('wikidata', node.tags.wikidata, ref);
	}
	return [...warnings, ...errors];
}

/**
 * Problems of the shared facts library: as an error, a file or record the build would reject; as warnings, the records
 * no hike uses. A record is used when the facts reader, run as the build runs it on each post (a hike with no post on
 * its own), takes it for a `use` or a stop's place. A hike whose facts can't be read is an error of its own, and is
 * named on every warning, since it may use the record.
 */
export function libraryProblems(root: string): Problem[] {
	const p = repoPaths(root);
	if (!existsSync(p.factsLibrary)) return [];
	const file = path.basename(p.factsLibrary);
	let library: FactsLibrary;
	try {
		library = readFactsLibraryFile(root);
	} catch (e) {
		return [{ level: 'error', file, message: e instanceof Error ? e.message : String(e) }];
	}
	const used = new Set<string>();
	const unread: string[] = [];
	const errors: Problem[] = [];
	const watch = watchedLibrary(library, (key) => used.add(key));
	for (const doc of factsDocs(root)) {
		try {
			const r = readDocFacts(root, doc.ref, { library: watch });
			if (r.error !== null) throw new Error(r.error);
		} catch (e) {
			// Its other records may be in use too, so the warnings below say which hikes weren't read.
			unread.push(doc.name);
			errors.push({ level: 'error', file: path.relative(root, doc.file), message: e instanceof Error ? e.message : String(e) });
		}
	}
	const note = unread.length ? ` (could not read: ${unread.join(', ')})` : '';
	const warnings = LIBRARY_KINDS.flatMap((kind) =>
		Object.keys(library[kind]).filter((id) => !used.has(`${kind}/${id}`)).map((id): Problem => ({ level: 'warning', file, message: `${RECORD_NAMES[kind]} "${id}" is used by no hike${note}` }))
	);
	return [...errors, ...warnings];
}

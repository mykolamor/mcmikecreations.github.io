import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTree, type Node, type ParseError } from 'jsonc-parser';
import { isMap } from 'yaml';
import schemaKeys from '$lib/hikes/schema-keys.json';
import type { FactsLibrary } from '$lib/hikes/facts-library.server';
import { parseFactsLibrary, serializeFactsLibrary } from '../lib/facts-library-file';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { parseStore, serializeStore, WholeFloat, type Store } from '../lib/osm-store-file';
import { writeAtomic } from '../server/doc';
import { repoPaths } from '../server/paths';
import { putScalar } from '../server/photo-ops';
import { lineIndent } from '../server/sidecar-file';
import { createTerrain, type Terrain } from '../server/terrain';
import type { Command, Output, ParsedArgs } from './index';
import { docFiles, dryRunNote } from './posts';

const FACTS_PLACE_KEYS = new Set<string>(schemaKeys.factsPlaceKeys);

/** A height as Python's str(float) spells it: whole metres keep their `.0` (`1577.0`), as every writer of demEle does. */
const pyFloat = (h: number): string => (Number.isInteger(h) ? `${h}.0` : String(h));

const isNumber = (v: unknown): boolean => typeof v === 'number' || v instanceof Number;

/** How many of the doc's located `images` entries get a new demEle; the new text when any do. */
function photosOf(raw: string, terrain: Terrain): { n: number; text: string } {
	const { doc, body } = readFrontmatterDoc(raw);
	const images = doc.get('images', true);
	if (!isMap(images)) return { n: 0, text: raw };
	let n = 0;
	for (const { value: entry } of images.items) {
		if (!isMap(entry)) continue;
		const lat = entry.get('lat');
		const lon = entry.get('lon');
		if (typeof lat !== 'number' || typeof lon !== 'number') continue;
		const h = terrain.height(lat, lon);
		const cur = entry.get('demEle');
		if (h === null || (typeof cur === 'number' && cur === h)) continue;
		putScalar(entry, 'demEle', h); // a float, as ruamel wrote it: 1086.0, not 1086
		n++;
	}
	return { n, text: n ? writeFrontmatterDoc(doc, body) : raw };
}

/** How many store elements get a new demEle (`tags.ele` is left alone); the store is updated in place. */
function storeOf(store: Store, terrain: Terrain): number {
	let n = 0;
	for (const [ref, e] of Object.entries(store)) {
		if (!isNumber(e.lat) || !isNumber(e.lon)) continue;
		const h = terrain.height(Number(e.lat), Number(e.lon));
		if (h === null || (isNumber(e.demEle) && Number(e.demEle) === h)) continue;
		store[ref] = { ...e, demEle: Number.isInteger(h) ? new WholeFloat(h) : h };
		n++;
	}
	return n;
}

type Splice = { at: number; drop: number; text: string };

const props = (node: Node): Map<string, Node> => new Map((node.children ?? []).map((p) => [p.children![0].value as string, p]));

/** A `{lat, lon}` facts place (facts.server.ts `readRawPlace`), as the former backfill_terrain.py `_is_facts_place`. */
function isFactsPlace(node: Node): boolean {
	if (node.type !== 'object') return false;
	const ps = props(node);
	return ['lat', 'lon'].every((k) => ps.get(k)?.children?.[1]?.type === 'number') && [...ps.keys()].every((k) => FACTS_PLACE_KEYS.has(k));
}

/**
 * Splices that set `demEle` on every facts place under `node`: the value replaced where there is one, else a new
 * `"demEle"` line right after `lon`, as the Python wrote it. Only those bytes change; the rest keeps its layout.
 */
function factsSplices(text: string, node: Node, terrain: Terrain, out: Splice[]): void {
	if (isFactsPlace(node)) {
		const ps = props(node);
		const h = terrain.height(ps.get('lat')!.children![1].value, ps.get('lon')!.children![1].value);
		if (h === null) return;
		const dem = ps.get('demEle')?.children?.[1];
		if (dem?.type === 'number' && dem.value === h) return;
		if (dem) {
			out.push({ at: dem.offset, drop: dem.length, text: pyFloat(h) });
			return;
		}
		const lon = ps.get('lon')!;
		const inline = !text.slice(node.offset, lon.offset).includes('\n');
		const sep = inline ? ', ' : `,\n${lineIndent(text, lon.offset)}`;
		out.push({ at: lon.offset + lon.length, drop: 0, text: `${sep}"demEle": ${pyFloat(h)}` });
		return;
	}
	if (node.type === 'object') for (const p of node.children ?? []) p.children?.[1] && factsSplices(text, p.children[1], terrain, out);
	else if (node.type === 'array') for (const c of node.children ?? []) factsSplices(text, c, terrain, out);
}

/** How many facts places of one `.hike.json` get a new demEle; the new text when any do. Its `nodes` are store ids. */
function sidecarOf(raw: string, terrain: Terrain): { n: number; text: string } {
	const errors: ParseError[] = [];
	const root = parseTree(raw, errors, { allowTrailingComma: false, disallowComments: true });
	if (errors.length || !root) throw new Error(`invalid JSON at offset ${errors[0]?.offset ?? 0}`);
	const facts = root.type === 'object' ? props(root).get('facts')?.children?.[1] : undefined;
	const splices: Splice[] = [];
	if (facts) factsSplices(raw, facts, terrain, splices);
	let text = raw;
	for (const s of splices.sort((a, b) => b.at - a.at)) text = text.slice(0, s.at) + s.text + text.slice(s.at + s.drop);
	return { n: splices.length, text };
}

/** How many `{lat, lon}` places in the library's records get a new demEle; the records are updated in place. */
function libraryOf(lib: FactsLibrary, terrain: Terrain): number {
	let n = 0;
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) return v.forEach(walk);
		if (typeof v !== 'object' || v === null) return;
		const o = v as Record<string, unknown>;
		if (typeof o.lat === 'number' && typeof o.lon === 'number' && Object.keys(o).every((k) => FACTS_PLACE_KEYS.has(k))) {
			const h = terrain.height(o.lat, o.lon);
			if (h === null || o.demEle === h) return;
			o.demEle = h;
			n++;
			return;
		}
		Object.values(o).forEach(walk);
	};
	walk(lib);
	return n;
}

/** The `terrain` command's work with the given heights (tests pass a fake). */
export async function backfillTerrain(root: string, args: ParsedArgs, out: Output, terrain: Terrain): Promise<number> {
	const dryRun = args.flags.has('dry-run');
	const note = dryRunNote(dryRun);
	const p = repoPaths(root);
	let failed = 0;
	/** Runs one file's update; writes `text` when it changed something, reports, and counts a failure instead of throwing. */
	const each = (file: string, unit: string, update: (raw: string) => { n: number; text: string }): number => {
		const rel = path.relative(root, file);
		try {
			const { n, text } = update(readFileSync(file, 'utf8'));
			if (!n) return 0;
			if (!dryRun) writeAtomic(file, text);
			out.change(rel, `set demEle on ${n} ${unit}`);
			return n;
		} catch (e) {
			out.warn(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
			failed++;
			return 0;
		}
	};

	if (!args.flags.has('no-photos')) {
		const docs = docFiles(root);
		const total = docs.reduce((sum, f) => sum + each(f, 'image(s)', (raw) => photosOf(raw, terrain)), 0);
		const places = docs.filter((f) => path.dirname(f) === p.places).length;
		out.summary(`photos: ${total} image(s) updated across ${docs.length - places} post(s) and ${places} place doc(s)${note}`);
	}

	if (!args.flags.has('no-nodes')) {
		const updated = existsSync(p.osmStore)
			? each(p.osmStore, 'element(s)', (raw) => {
					const store = parseStore(raw);
					const n = storeOf(store, terrain);
					return { n, text: n ? serializeStore(store) : '' };
				})
			: 0;
		out.summary(`store: ${updated} element(s) updated across 1 store${note}`);
		const sidecars = existsSync(p.markdown) ? readdirSync(p.markdown).filter((f) => f.endsWith('.hike.json')).sort().map((f) => path.join(p.markdown, f)) : [];
		const total = sidecars.reduce((sum, f) => sum + each(f, 'facts place(s)', (raw) => sidecarOf(raw, terrain)), 0);
		out.summary(`facts: ${total} facts place(s) updated across ${sidecars.length} file(s)${note}`);
		// The shared library, written back in its own byte-stable layout.
		if (existsSync(p.factsLibrary)) {
			const places = each(p.factsLibrary, 'library place(s)', (raw) => {
				const lib = parseFactsLibrary(raw);
				const n = libraryOf(lib, terrain);
				return { n, text: n ? serializeFactsLibrary(lib) : raw };
			});
			out.summary(`library: ${places} library place(s) updated across 1 file${note}`);
		}
	}
	return failed ? 1 : 0;
}

/** Port of the former scripts/matches/backfill_terrain.py: demEle (3D map terrain height) on located photos, osm.json elements, sidecar facts places and facts-library.json places. */
export const terrain: Command = {
	name: 'terrain',
	summary: '[--no-nodes] [--no-photos]  demEle (3D map terrain height) on located photos, osm.json elements, sidecar facts places and facts-library.json places',
	flags: ['no-nodes', 'no-photos', 'dry-run'],
	async run(root, args, out) {
		if (args.positional.length) {
			out.warn(`terrain takes no post names: ${args.positional.join(' ')}`);
			return 2;
		}
		return backfillTerrain(root, args, out, createTerrain(repoPaths(root).demDir));
	}
};

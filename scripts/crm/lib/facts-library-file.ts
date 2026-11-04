// Reads and writes the shared facts library (static/_projects/data-viz/hikes/facts-library.json)
// byte-stably: tab indentation; the record kinds in their fixed order; stop ids
// (OSM refs) sorted by type (node, way, relation) then numeric id, other ids
// sorted; every record's fields in the schema's order; non-ASCII unescaped;
// trailing newline. Each Text is written once, where it stands, with its
// languages together. Reading checks every record as the build does.
import { readFileSync } from 'node:fs';
import { orderLibraryRecord } from '$lib/hikes/facts.server';
import { LIBRARY_KINDS, readFactsLibrary, type FactsLibrary } from '$lib/hikes/facts-library.server';
import { writeAtomic } from '../server/doc';
import { repoPaths } from '../server/paths';

const SOURCE = 'facts-library.json';
const TYPES = ['node', 'way', 'relation'];

export function parseFactsLibrary(text: string): FactsLibrary {
	return readFactsLibrary(JSON.parse(text), SOURCE);
}

export function readFactsLibraryFile(root: string): FactsLibrary {
	return parseFactsLibrary(readFileSync(repoPaths(root).factsLibrary, 'utf-8'));
}

function byRef(a: string, b: string): number {
	const [ka, na] = a.split('/');
	const [kb, nb] = b.split('/');
	return TYPES.indexOf(ka) - TYPES.indexOf(kb) || Number(na) - Number(nb);
}

export function serializeFactsLibrary(lib: FactsLibrary): string {
	const out: Record<string, Record<string, unknown>> = {};
	for (const kind of LIBRARY_KINDS) {
		const records = (lib[kind] ?? {}) as Record<string, unknown>;
		const ids = Object.keys(records).sort(kind === 'stops' ? byRef : undefined);
		out[kind] = Object.fromEntries(ids.map((id) => [id, orderLibraryRecord(kind, records[id])]));
	}
	return JSON.stringify(out, null, '\t') + '\n';
}

export function writeFactsLibrary(root: string, lib: FactsLibrary): void {
	writeAtomic(repoPaths(root).factsLibrary, serializeFactsLibrary(lib));
}

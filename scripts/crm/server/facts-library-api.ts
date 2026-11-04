// The shared facts library as the Facts tab reads and writes it: the file's version, its records and which docs take
// each one. A write replaces or deletes one record, checked as the build checks it, and goes through the version
// protocol: a write made on a stale version (another tab, the CLI) is refused, never merged.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REF_RE } from '../../../src/lib/data/osm-store.js';
import { FactsError, validateLibraryRecord } from '../../../src/lib/hikes/facts.server';
import { LIBRARY_ID_RE, LIBRARY_KINDS, RECORD_NAMES, emptyFactsLibrary, type FactsLibrary, type LibraryKind } from '../../../src/lib/hikes/facts-library.server';
import { readFactsLibraryFile, writeFactsLibrary } from '../lib/facts-library-file';
import { versionOf } from './doc';
import { withDocLock } from './doc-lock';
import { ApiError } from './errors';
import { libraryUsage } from './facts-read';
import { repoPaths } from './paths';

const LOCK = 'facts-library';
const SOURCE = 'facts-library.json';

export type LibraryState = { version: string; library: FactsLibrary; usage: Record<string, string[]> };

/** Thrown when `base` is not the library's current version; the route answers 409 with the current version. */
export class StaleLibraryError extends ApiError {
	constructor(public version: string) {
		super(409, 'facts-library.json changed on disk');
	}
}

/** The sha1 of the library file's bytes (of nothing, when there is no file). */
export function libraryVersion(root: string): string {
	const file = repoPaths(root).factsLibrary;
	return versionOf(existsSync(file) ? readFileSync(file) : '');
}

const stat = (file: string) => (existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : '-');

/** Each file under `dir` (at any depth) with its size and time. */
function dirStats(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort().map((f) => `${f}=${stat(path.join(dir, f))}`);
}

/**
 * What the usage is read from: the hike files, the route GeoJSON and bailout GPX files, the store and hikes.json as
 * they are on disk (by size and time), and the record ids (a record's content doesn't change who takes it).
 */
function usageInputs(root: string, library: FactsLibrary): string {
	const p = repoPaths(root);
	const ids = LIBRARY_KINDS.flatMap((kind) => Object.keys(library[kind]).map((id) => `${kind}/${id}`));
	return JSON.stringify([root, dirStats(p.markdown), dirStats(p.geojson), dirStats(p.bailouts), stat(p.osmStore), stat(p.hikesJson), ids]);
}

// Reading every doc takes seconds: the last usage is kept while its inputs stay the same.
let lastUsage: { inputs: string; usage: Record<string, string[]> } | null = null;

function usageOf(root: string, library: FactsLibrary): Record<string, string[]> {
	const inputs = usageInputs(root, library);
	if (lastUsage?.inputs !== inputs) lastUsage = { inputs, usage: libraryUsage(root) };
	return structuredClone(lastUsage.usage);
}

export function libraryState(root: string): LibraryState {
	const library = existsSync(repoPaths(root).factsLibrary) ? readFactsLibraryFile(root) : emptyFactsLibrary();
	return { version: libraryVersion(root), library, usage: usageOf(root, library) };
}

/**
 * Sets the record `kind`/`id` (a stop's id is its OSM ref), or deletes it with `null`, on the library at version
 * `base`; answers the new state. A record is checked as the build checks it (400 with its message); a record some doc
 * takes can't be deleted (400 naming them).
 */
export function putLibraryRecord(root: string, kind: string, id: string, record: unknown, base: string): Promise<LibraryState> {
	if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, `kind must be one of: ${LIBRARY_KINDS.join(', ')}`);
	const k = kind as LibraryKind;
	if (k === 'stops' ? !REF_RE.test(id) : !LIBRARY_ID_RE.test(id))
		throw new ApiError(400, k === 'stops' ? 'a stop record is keyed by a typed OSM ref, node/…, way/… or relation/…' : 'an id is lowercase words joined by "-"');
	if (record !== null) {
		try {
			validateLibraryRecord(k, id, record, SOURCE);
		} catch (e) {
			if (e instanceof FactsError) throw new ApiError(400, e.message);
			throw e;
		}
	}
	return withDocLock(LOCK, () => {
		const version = libraryVersion(root);
		if (version !== base) throw new StaleLibraryError(version);
		const library = existsSync(repoPaths(root).factsLibrary) ? readFactsLibraryFile(root) : emptyFactsLibrary();
		const records = library[k] as Record<string, unknown>;
		if (record === null) {
			if (!Object.hasOwn(records, id)) throw new ApiError(400, `no ${RECORD_NAMES[k]} record "${id}"`);
			const users = usageOf(root, library)[`${k}/${id}`] ?? [];
			if (users.length) throw new ApiError(400, `${RECORD_NAMES[k]} "${id}" is used by: ${users.join(', ')}`);
			delete records[id];
		} else {
			records[id] = record;
		}
		writeFactsLibrary(root, library);
		return libraryState(root);
	});
}

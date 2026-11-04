/**
 * The shared facts library, `static/_projects/data-viz/hikes/facts-library.json`:
 * stops, transport, lifts, parking and tickets written once and used by any
 * number of hikes. A `transport`, `lifts`, `parking` or `tickets` entry names
 * its record with `use: "<id>"`; a stop starts from the record keyed by the
 * OSM ref its `at` resolves to. Either way the hike's own fields deep-merge on
 * top (library ← sidecar ← post), in `readHikeFacts`.
 *
 * A record is the matching facts entry without what ties it to one hike: a
 * stop's record has no `at` (its key is the place), the others no `use`.
 * Places and texts stay as written; each hike resolves them on its own route.
 *
 * Server-only, like `facts.server.ts`, which it validates with; browser code
 * may only use type-only imports (`import type`) from it.
 */

import { REF_RE } from '$lib/data/osm-store';
import { FactsError, validateLibraryRecord } from './facts.server';
import type { Lift, Parking, Place, Stop, Text, Ticket, Transport } from './facts-schema';
import { LIBRARY_ID_RE, LIBRARY_KINDS, type LibraryKind } from './facts-spec';

export { LIBRARY_ID_RE, LIBRARY_KINDS, type LibraryKind };

/** A record's name in messages. */
export const RECORD_NAMES: Record<LibraryKind, string> = { stops: 'stop', transport: 'transport', lifts: 'lift', parking: 'parking', tickets: 'ticket' };

/** A text as written: a string, or one key per language. */
export type AuthoredText = string | Text;

/** A place as written: a node name or `km 7.5`, a typed OSM ref, a distance, or a point. */
export type AuthoredPlace =
	| string
	| { ref: string; name?: AuthoredText }
	| { km: number }
	| { lat: number; lon: number; name?: AuthoredText; ele?: number; demEle?: number };

/** A page type as it is written in a file, before a hike resolves it. */
export type Authored<T> = T extends Place
	? AuthoredPlace
	: T extends Text
		? AuthoredText
		: T extends readonly (infer U)[]
			? Authored<U>[]
			: T extends object
				? { [K in keyof T]: Authored<T[K]> }
				: T;

export type StopRecord = Authored<Omit<Stop, 'at'>>;
export type TransportRecord = Authored<Transport>;
export type LiftRecord = Authored<Lift>;
export type ParkingRecord = Authored<Parking>;
export type TicketRecord = Authored<Ticket>;

export type FactsLibrary = {
	stops: Record<string, StopRecord>;
	transport: Record<string, TransportRecord>;
	lifts: Record<string, LiftRecord>;
	parking: Record<string, ParkingRecord>;
	tickets: Record<string, TicketRecord>;
};

export function emptyFactsLibrary(): FactsLibrary {
	return { stops: {}, transport: {}, lifts: {}, parking: {}, tickets: {} };
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The library file's content, every record checked with the facts entry's
 * spec: anything malformed throws, naming `source`, the kind, the id and the
 * path. The records come back as written, so a writer can round-trip them.
 */
export function readFactsLibrary(raw: unknown, source: string): FactsLibrary {
	const fail = (path: string, problem: string): never => {
		throw new FactsError(`Hike facts in ${source}${path ? `: ${path}` : ''}: ${problem}`);
	};
	if (!isObj(raw)) fail('', `expected a mapping of ${LIBRARY_KINDS.join(', ')}`);
	const file = raw as Record<string, unknown>;
	for (const kind of Object.keys(file)) {
		if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) fail(kind, `unknown record kind (expected one of: ${LIBRARY_KINDS.join(', ')})`);
	}
	const out = emptyFactsLibrary();
	for (const kind of LIBRARY_KINDS) {
		const records = file[kind] ?? {};
		if (!isObj(records)) fail(kind, 'expected a mapping of record ids');
		for (const [id, record] of Object.entries(records as Record<string, unknown>)) {
			if (kind === 'stops' ? !REF_RE.test(id) : !LIBRARY_ID_RE.test(id)) {
				fail(`${kind}.${id}`, kind === 'stops' ? 'expected a typed OSM ref, node/…, way/… or relation/…' : 'expected an id of lowercase words joined by "-"');
			}
			validateLibraryRecord(kind, id, record, source);
			(out[kind] as Record<string, unknown>)[id] = record;
		}
	}
	return out;
}

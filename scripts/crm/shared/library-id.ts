// A new library record's id (Plan 2's rule, which the extraction one-off gave the first records): transport
// `<mode>-<line or from>-<to>`, the other kinds their English `name`, else `at`, slugified; `-2`, `-3` on a clash.
// A stop's record is keyed by its OSM ref instead. Browser-safe.
import type { LibraryKind } from '$lib/hikes/facts-spec';

type Entry = Record<string, unknown>;

const isObj = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/** Where each kind's entries live under `facts`. */
export const LIST_PATHS: Record<LibraryKind, string[]> = {
	stops: ['stops'],
	transport: ['access', 'transport'],
	lifts: ['access', 'lifts'],
	parking: ['access', 'parking'],
	tickets: ['access', 'tickets']
};

/** A text's, a place's or a spot's English label. */
export function label(v: unknown): string {
	if (typeof v === 'string') return v;
	if (typeof v === 'number') return String(v);
	if (!isObj(v)) return '';
	if (typeof v.en === 'string') return v.en;
	if (v.name !== undefined) return label(v.name);
	if (typeof v.ref === 'string') return v.ref;
	if (typeof v.km === 'number') return `km ${v.km}`;
	return '';
}

export function slugify(s: string): string {
	return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The id an entry's record is given before any clash. */
export function baseId(kind: LibraryKind, e: Entry): string {
	const words = kind === 'transport' ? [label(e.mode), label(e.line ?? e.from), label(e.to)] : [label(e.name) || label(e.at)];
	return slugify(words.join(' ')) || kind;
}

/** The entry's record id, `-2`, `-3`… added while `taken` has it. */
export function recordId(kind: LibraryKind, e: Entry, taken: Record<string, unknown>): string {
	const base = baseId(kind, e);
	let id = base;
	for (let n = 2; id in taken; n++) id = `${base}-${n}`;
	return id;
}

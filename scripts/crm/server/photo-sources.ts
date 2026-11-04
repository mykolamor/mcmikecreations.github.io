// Photo sources for the CRM: which Immich album belongs to a hike, which assets are candidates, and how they group into bursts.
import { readFrontmatterDoc } from '../lib/frontmatter';
import { distanceM } from '../shared/snap';
import { linksKey, type DocRef, type EnglishRef } from './doc-ref';
import { ApiError } from './errors';
import { assertSafeDate } from './paths';
import { readLinks } from './immich-links';
import { loadPlace } from './place-doc';
import type { Asset, Immich } from './immich-client';

export type Album = { id: string; name: string };
export type Burst = { id: string; assets: Asset[] };

/** Port of the former scripts/matches/config.py DEFAULT_ALBUM_COVERAGE_MIN. */
const ALBUM_COVERAGE_MIN = 0.5;
const BURST_MAX_S = 30;
const BURST_MAX_M = 30;

const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

/** Fraction of the slug's tokens present in the album name (not Jaccard: album names carry a location prefix). */
function coverage(slug: string, name: string): number {
	const s = tokenize(slug);
	if (!s.size) return 0;
	const n = tokenize(name);
	return [...s].filter((t) => n.has(t)).length / s.size;
}

export function guessAlbum(slug: string, albums: Album[]): Album | null {
	const scored = albums.map((a) => ({ a, c: coverage(slug, a.name) })).filter((x) => x.c >= ALBUM_COVERAGE_MIN && x.c > 0);
	scored.sort((x, y) => y.c - x.c || (x.a.name < y.a.name ? -1 : x.a.name > y.a.name ? 1 : 0));
	return scored.length ? { id: scored[0].a.id, name: scored[0].a.name } : null;
}

export function bursts(assets: Asset[]): Burst[] {
	const ms = (a: Asset) => new Date(a.takenLocal).getTime();
	const timed = assets.filter((a) => Number.isFinite(ms(a)));
	const untimed = assets.filter((a) => !Number.isFinite(ms(a)));
	const cmp = (a: Asset, b: Asset, t: (x: Asset) => number) => t(a) - t(b) || (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const sorted = timed.sort((a, b) => cmp(a, b, ms));
	const out: Burst[] = [];
	let prev: Asset | null = null;
	for (const a of sorted) {
		const gps = (x: Asset) => x.lat !== undefined && x.lon !== undefined;
		const joins =
			prev !== null &&
			(ms(a) - ms(prev)) / 1000 <= BURST_MAX_S &&
			(!gps(a) || !gps(prev) || distanceM({ lat: prev.lat!, lon: prev.lon! }, { lat: a.lat!, lon: a.lon! }) <= BURST_MAX_M);
		if (joins) out[out.length - 1].assets.push(a);
		else out.push({ id: a.id, assets: [a] });
		prev = a;
	}
	// No usable time: one final burst, ordered by name, so they never disturb the timed ones.
	if (untimed.length) {
		untimed.sort((a, b) => cmp(a, b, () => 0));
		out.push({ id: untimed[0].id, assets: untimed });
	}
	return out;
}

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const shift = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return day(y, m, d + n);
};
const localStart = (date: string, plusDays = 0) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(y, m - 1, d + plusDays).toISOString();
};

const PAD_MS = 14 * 3600e3;
const padded = (date: string, plusDays: number, dir: 1 | -1) => new Date(new Date(localStart(date, plusDays)).getTime() + dir * PAD_MS).toISOString();

/** `query` (place docs only): the smart-search text, default the doc's title. */
export type CandidateParams = { ref: EnglishRef; album?: string; from?: string | null; to?: string | null; query?: string | null };
export type Candidates = {
	album: Album | null;
	albums: Album[];
	/** The date window; for a place doc searched without one, both ends are ''. */
	window: { from: string; to: string };
	bursts: Burst[];
	inPost: Record<string, string>;
	/** The smart-search text used (place docs only). */
	query?: string;
};

/** The padded query is only a net; the local date in takenLocal decides, so travel photos are not clipped by this machine's zone. */
const inWindow = (assets: Asset[], from: string, to: string): Asset[] =>
	assets.filter((a) => {
		if (!Number.isFinite(new Date(a.takenLocal).getTime())) return true;
		const d = a.takenLocal.slice(0, 10);
		return d >= from && d <= to;
	});

/** Immich asset id → image key for the assets the doc already links. */
function linkedIn(root: string, ref: DocRef): Record<string, string> {
	const inPost: Record<string, string> = {};
	if (ref.kind !== 'hike') for (const [key, id] of Object.entries(readLinks(root)[linksKey(ref)] ?? {})) inPost[id] = key;
	return inPost;
}

/**
 * A place doc's candidates: Immich smart search for `query` (default the doc's title), optionally narrowed to the
 * `from`..`to` local dates. No album: a place is photographed on many hikes.
 */
async function placeCandidates(root: string, immich: Immich, ref: Extract<DocRef, { kind: 'place' }>, p: CandidateParams): Promise<Candidates> {
	const doc = loadPlace(root, ref.slug);
	if (!p.from !== !p.to) throw new ApiError(400, 'from and to go together');
	const from = p.from ? assertSafeDate(p.from) : '';
	const to = p.to ? assertSafeDate(p.to) : '';
	if (from > to) throw new ApiError(400, 'from must not be after to');
	const title = readFrontmatterDoc(doc.raw).doc.get('title');
	const query = p.query?.trim() || (typeof title === 'string' && title.trim() ? title.trim() : ref.slug);
	const raw = await immich.smart(query);
	return { album: null, albums: [], window: { from, to }, bursts: bursts(from ? inWindow(raw, from, to) : raw), inPost: linkedIn(root, ref), query };
}

export async function candidates(root: string, immich: Immich, p: CandidateParams): Promise<Candidates> {
	const ref = p.ref;
	if (ref.kind === 'place') return placeCandidates(root, immich, ref, p);
	const date = ref.kind === 'post' ? ref.date : null;
	const from = p.from ? assertSafeDate(p.from) : date ? shift(date, -1) : null;
	const to = p.to ? assertSafeDate(p.to) : date ? shift(date, 1) : null;
	// Only a hike alone lacks a date; it searches only with a whole window.
	if (!from || !to) throw new ApiError(400, p.from || p.to ? 'from and to go together' : 'a dated visit or a place doc is required');
	if (from > to) throw new ApiError(400, 'from must not be after to');
	const albums = await immich.albums();
	const mode = p.album || 'guess';
	const album = mode === 'none' ? null : mode === 'guess' ? guessAlbum(ref.slug, albums) : (albums.find((a) => a.id === mode) ?? { id: mode, name: mode });
	const raw = await immich.search({ ...(album ? { albumId: album.id } : {}), takenAfter: padded(from, 0, -1), takenBefore: padded(to, 1, 1) });
	return { album, albums, window: { from, to }, bursts: bursts(inWindow(raw, from, to)), inPost: linkedIn(root, ref) };
}

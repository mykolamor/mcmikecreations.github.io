import { existsSync, readFileSync } from 'node:fs';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { resolveGpxUrl, served } from '../server/files';
import { repoPaths } from '../server/paths';
import { AGREE_M, gapAwarePositionAt, recordedTrack, segmentDistanceM, TRACK_SLACK_MS, trackDistanceM, type TrackPoint } from '../server/photo-badges';
import { ctxOf, editEntry, putScalar } from '../server/photo-ops';
import { createTerrain, type Terrain } from '../server/terrain';
import type { Command, Output, ParsedArgs } from './index';
import { dryRunNote, forEachPost, plural } from './posts';

const TAKEN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const TRACK_LOCATION_KEYS = ['lat', 'lon', 'demEle', 'located'] as const;
const DAY_MS = 24 * 3600 * 1000;
const GPX_URL = '/_projects/data-viz/hikes/gpx/';
/** An existing track position this close to the track's path in the second of `taken` is kept (6-dp rounding is 0.1 m). */
const KEEP_M = 0.5;

type Stamp = { utc: number; offsetMin: number; localDate: string };
/** Fields to set on one images entry; null removes the field. */
export type Fields = Record<string, number | string | null>;
export type Unbelievable = { key: string; taken: string; why: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const pad2 = (n: number) => String(n).padStart(2, '0');
const offsetLabel = (min: number) => `${min < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(min) / 60))}:${pad2(Math.abs(min) % 60)}`;

/** A front-matter `taken` (local wall clock with its UTC offset), or null when it isn't one. */
function readStamp(taken: string): Stamp | null {
	const m = TAKEN.exec(taken);
	const utc = m ? Date.parse(taken) : NaN;
	if (!m || !Number.isFinite(utc)) return null;
	const offsetMin = m[2] === 'Z' ? 0 : (m[2][0] === '-' ? -1 : 1) * (+m[2].slice(1, 3) * 60 + +m[2].slice(4, 6));
	return { utc, offsetMin, localDate: m[1] };
}

/** The offset most of the stamps have (the first one seen on a tie, as Python's Counter.most_common). */
function usualOffset(stamps: Stamp[]): number | null {
	const counts = new Map<number, number>();
	for (const s of stamps) counts.set(s.offsetMin, (counts.get(s.offsetMin) ?? 0) + 1);
	let best: number | null = null;
	for (const [off, n] of counts) if (best === null || n > counts.get(best)!) best = off;
	return best;
}

/** Local dates (at `offsetMin`) the recorded track spans. */
function trackDates(track: TrackPoint[], offsetMin: number): Set<string> {
	const day = (t: number) => Math.floor((t + offsetMin * 60000) / DAY_MS);
	const out = new Set<string>();
	for (let d = day(track[0].t); d <= day(track[track.length - 1].t); d++) out.add(new Date(d * DAY_MS).toISOString().slice(0, 10));
	return out;
}

/**
 * Port of the former backfill_time.py `time_updates`, with the front matter's `taken` as the source: what to change per image
 * key, and the `taken` values that aren't believable. Those are reported, never removed (the front matter is now
 * their only copy). A recorded hike has a timed track (2+ points); without one the post date is the check.
 * Photo GPS is never touched; track positions are set, refreshed or dropped.
 */
export function timeUpdates(postDate: string, images: Record<string, any>, track: TrackPoint[], terrain: Terrain): { updates: Record<string, Fields>; unbelievable: Unbelievable[] } {
	const recorded = track.length >= 2;
	const stamps = new Map<string, Stamp>();
	for (const [key, meta] of Object.entries(images)) {
		const s = typeof meta?.taken === 'string' ? readStamp(meta.taken) : null;
		if (s) stamps.set(key, s);
	}
	const usual = usualOffset([...stamps.values()]);
	const dates = recorded && usual !== null ? trackDates(track, usual) : null;

	/** Why `s` is not believable for this photo, or null when it is. */
	const doubt = (s: Stamp, gps: { lat: number; lon: number } | null): string | null => {
		if (s.offsetMin !== usual) return `offset ${offsetLabel(s.offsetMin)}, the post's photos are at ${offsetLabel(usual!)}`;
		if (!recorded) return s.localDate === postDate ? null : `not the post date ${postDate}`;
		if (!dates!.has(s.localDate)) return `${s.localDate} is not a day of the recording`;
		if (!gps) return null;
		const d = trackDistanceM(track, s.utc, gps.lat, gps.lon);
		return d <= AGREE_M ? null : `the track was ${Math.round(d)} m from the photo at that time`;
	};

	const updates: Record<string, Fields> = {};
	const unbelievable: Unbelievable[] = [];
	for (const [key, meta] of Object.entries(images)) {
		if (!meta || typeof meta !== 'object') continue;
		const fromTrack = meta.located === 'track';
		const gps = !fromTrack && isNum(meta.lat) && isNum(meta.lon) ? { lat: meta.lat, lon: meta.lon } : null;
		const s = stamps.get(key);
		const why = s ? doubt(s, gps) : meta.taken == null ? undefined : 'not a local time with offset';
		if (why) unbelievable.push({ key, taken: String(meta.taken), why });

		const wanted: Fields = {};
		if (s && why === null && recorded && !gps) {
			const first = track[0].t;
			const last = track[track.length - 1].t;
			// Off the recording or inside a gap where it moved: the time stands, the place is unknown.
			const at = (t: number) => gapAwarePositionAt(track, Math.min(Math.max(t, first), last));
			const pos = s.utc >= first - TRACK_SLACK_MS && s.utc <= last + TRACK_SLACK_MS ? at(s.utc) : null;
			if (pos) {
				// The Python placed photos at Immich's millisecond time; `taken` has whole seconds. Within that second the
				// track went from `pos` to `end`: a track position on that path is kept, not moved by a metre.
				const end = at(s.utc + 999) ?? pos;
				const keep = fromTrack && isNum(meta.lat) && isNum(meta.lon) && segmentDistanceM(meta.lat, meta.lon, pos, end) <= KEEP_M;
				const lat = keep ? meta.lat : round6(pos.lat);
				const lon = keep ? meta.lon : round6(pos.lon);
				const h = terrain.height(lat, lon);
				Object.assign(wanted, { lat, lon, ...(h === null ? {} : { demEle: h }), located: 'track' });
			}
		}

		const fields: Fields = {};
		for (const [k, v] of Object.entries(wanted)) if (meta[k] !== v) fields[k] = v;
		if (fromTrack) for (const k of TRACK_LOCATION_KEYS) if (k in meta && !(k in wanted)) fields[k] = null;
		if (Object.keys(fields).length) updates[key] = fields;
	}
	return { updates, unbelievable };
}

/** The post's recorded track ([] for a planned one or none); throws for a linked file that isn't a GPX. */
function trackOf(root: string, slug: string, front: any): TrackPoint[] {
	const g = resolveGpxUrl(root, slug, front);
	const f = g && served(root, g.url, GPX_URL, repoPaths(root).gpx);
	if (f && existsSync(f) && !/<gpx[\s>]/.test(readFileSync(f, 'utf8'))) throw new Error(`${g!.url} is not a GPX file`);
	return recordedTrack(root, slug, front);
}

/** The `photo-times` command's work with the given heights (tests pass a fake). */
export async function backfillPhotoTimes(root: string, args: ParsedArgs, out: Output, terrain: Terrain): Promise<number> {
	const dryRun = args.flags.has('dry-run');
	let changed = 0;
	let placed = 0;
	let dropped = 0;
	let reported = 0;
	const failed = await forEachPost(root, args.positional, out, ({ file, rel, date, slug }) => {
		const front = (readFrontmatterDoc(readFileSync(file, 'utf8')).doc.toJS() ?? {}) as any;
		const images = front.images && typeof front.images === 'object' ? front.images : {};
		if (!Object.keys(images).length) return;
		const { updates, unbelievable } = timeUpdates(date, images, trackOf(root, slug, front), terrain);
		for (const u of unbelievable) out.warn(`${rel}: ${u.key}: taken ${u.taken} not believable (${u.why}); left as is`);
		reported += unbelievable.length;

		const keys = Object.keys(updates);
		if (!keys.length) return;
		if (!dryRun) editEntry(ctxOf(root, { kind: 'post', slug, date }), keys, (key, entry) => {
			for (const [k, v] of Object.entries(updates[key])) putScalar(entry, k, v ?? undefined);
		}, false);
		const n = { placed: 0, moved: 0, dropped: 0 };
		for (const f of Object.values(updates)) n[f.located === 'track' ? 'placed' : f.located === null ? 'dropped' : 'moved']++;
		const what = [];
		if (n.placed) what.push(`placed ${n.placed} photo(s) on the track`);
		if (n.moved) what.push(`moved ${n.moved} track position(s)`);
		if (n.dropped) what.push(`dropped ${n.dropped} track position(s)`);
		out.change(rel, what.join(', '));
		placed += n.placed;
		dropped += n.dropped;
		changed++;
	});
	const parts = [`${plural(changed, 'post')} ${dryRun ? 'to change' : 'changed'}`, `${placed} photo(s) placed on the track`, `${dropped} track position(s) dropped`];
	if (reported) parts.push(`${reported} unbelievable taken reported`);
	if (failed) parts.push(`${failed} failed`);
	out.summary(`photo-times: ${parts.join(', ')}${dryRunNote(dryRun)}`);
	return failed ? 1 : 0;
}

/** Port of the former scripts/matches/backfill_time.py: checks each photo's `taken`, and places photos without GPS on the recorded track. */
export const photoTimes: Command = {
	name: 'photo-times',
	summary: "[posts…]  check each photo's taken, place photos without GPS on the recorded track (located: track)",
	flags: ['dry-run'],
	run: (root, args, out) => backfillPhotoTimes(root, args, out, createTerrain(repoPaths(root).demDir))
};

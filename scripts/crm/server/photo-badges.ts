// Problem badges for a post's (or place doc's) photos, and the recorded GPX / route lookups they (and the location fixes) share.
import { existsSync, readFileSync } from 'node:fs';
import { routeLocator } from '../../../src/lib/hikes/photo-stops';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { placePath, type DocRef, type EnglishRef } from './doc-ref';
import { loadDoc, postPath } from './doc';
import { ApiError } from './errors';
import { geojsonTarget, resolveGpxUrl, served } from './files';
import { repoPaths } from './paths';
import { loadPlace } from './place-doc';
import { haversineM, MAX_INTERVAL_S, readTrack } from './track-metrics';

export type Badge = 'no time' | 'no location' | 'off route' | 'outside track';
export type TrackPoint = { lat: number; lon: number; /** Unix milliseconds. */ t: number };

/** A photo may be taken this long before/after the recording and still count as inside it. */
export const TRACK_SLACK_MS = 15 * 60 * 1000;
const GPX_URL = '/_projects/data-viz/hikes/gpx/';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Problems per image key (only keys with any). `doc` is the post's front matter; `route` the GeoJSON coordinates
 * `[lon, lat, ele?]` (off route = further than the site's 300 m rule from it); `trackPoints` the recorded GPX with times.
 */
export function badges(doc: { images?: Record<string, any> | null }, trackPoints: TrackPoint[], route: number[][] | null): Record<string, Badge[]> {
	const out: Record<string, Badge[]> = {};
	const locate = route && route.length ? routeLocator(route, 1) : null;
	const times = trackPoints.map((p) => p.t);
	const from = times.length ? Math.min(...times) - TRACK_SLACK_MS : NaN;
	const to = times.length ? Math.max(...times) + TRACK_SLACK_MS : NaN;
	for (const [key, im] of Object.entries(doc.images ?? {})) {
		const list: Badge[] = [];
		const taken = typeof im?.taken === 'string' ? Date.parse(im.taken) : NaN;
		if (!Number.isFinite(taken)) list.push('no time');
		const located = isNum(im?.lat) && isNum(im?.lon);
		if (!located) list.push('no location');
		else if (locate && locate(im.lat, im.lon).length === 0) list.push('off route');
		if (Number.isFinite(taken) && times.length >= 2 && (taken < from || taken > to)) list.push('outside track');
		if (list.length) out[key] = list;
	}
	return out;
}

/** Whether a front matter's `images` has a photo with at least one pin (the Open screen's badge, the Photos tab's dot). */
export function hasPins(front: { images?: unknown } | null | undefined): boolean {
	const images = front?.images;
	if (typeof images !== 'object' || images === null) return false;
	return Object.values(images).some((im) => Array.isArray((im as { pins?: unknown } | null)?.pins) && (im as { pins: unknown[] }).pins.length > 0);
}

/** Whether the post or place doc `ref` names has a pinned photo; a hike alone has no photos. False for a missing or unreadable file. */
export function docHasPins(root: string, ref: EnglishRef): boolean {
	if (ref.kind === 'hike') return false;
	const file = ref.kind === 'place' ? placePath(root, ref.slug) : postPath(root, ref.slug, ref.date);
	try {
		return hasPins(readFrontmatterDoc(readFileSync(file, 'utf8')).doc.toJS());
	} catch {
		return false;
	}
}

/** The recorded GPX (the post's, resolved like the site) as timed points; [] when there is none or it has no times. */
export function recordedTrack(root: string, slug: string, front: any): TrackPoint[] {
	const g = resolveGpxUrl(root, slug, front);
	const f = g && served(root, g.url, GPX_URL, repoPaths(root).gpx);
	if (!f || !existsSync(f)) return [];
	return readTrack(readFileSync(f, 'utf8'))
		.map((p) => ({ lat: p.lat, lon: p.lon, t: p.time * 1000 }))
		.sort((a, b) => a.t - b.t);
}

/** The route GeoJSON's first LineString coordinates, or null. */
export function routeOf(root: string, slug: string, front: any): number[][] | null {
	const t = geojsonTarget(root, slug, front);
	if (!t || !existsSync(t.file)) return null;
	try {
		const v = JSON.parse(readFileSync(t.file, 'utf8'));
		for (const f of v?.features ?? []) {
			const g = f?.geometry;
			if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) return g.coordinates;
		}
	} catch {
		/* unreadable route: no off-route badges */
	}
	return null;
}

/** The recorded position at unix ms `t`, interpolated between its two trackpoints; 422 outside the recording. */
export function positionAt(track: TrackPoint[], t: number): { lat: number; lon: number } {
	if (track.length < 2) throw new ApiError(422, 'This post has no timed GPX recording');
	if (t < track[0].t || t > track[track.length - 1].t) throw new ApiError(422, 'The photo was taken outside the recording');
	let i = 1;
	while (i < track.length - 1 && track[i].t < t) i++;
	const a = track[i - 1];
	const b = track[i];
	const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
	return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** A photo's position and the track's at its time agree within this (m); also a gap's ends at "the same place". */
export const AGREE_M = 250;
const GAP_MS = MAX_INTERVAL_S * 1000;

/** Index of the first point at or after unix ms `t` (`t` inside the track). */
function after(track: TrackPoint[], t: number): number {
	let lo = 0;
	let hi = track.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (track[mid].t < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Where the recorded track was at unix ms `t`, as the former backfill_time.py `position_at`: null outside the recording, and
 * inside a recording gap unless both its ends are at the same place (a break or a night at a hut).
 */
export function gapAwarePositionAt(track: TrackPoint[], t: number): { lat: number; lon: number } | null {
	if (!track.length || t < track[0].t || t > track[track.length - 1].t) return null;
	const i = after(track, t);
	if (track[i].t === t) return { lat: track[i].lat, lon: track[i].lon };
	const a = track[i - 1];
	const b = track[i];
	if (b.t - a.t > GAP_MS && haversineM(a, b) > AGREE_M) return null;
	const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
	return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Distance (m) from (lat, lon) to the straight segment a-b, on a local flat projection. */
export function segmentDistanceM(lat: number, lon: number, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const k = Math.cos((lat * Math.PI) / 180);
	const [ax, ay] = [(a.lon - lon) * k, a.lat - lat];
	const [bx, by] = [(b.lon - lon) * k, b.lat - lat];
	const [dx, dy] = [bx - ax, by - ay];
	const f = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
	return haversineM({ lat, lon }, { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
}

/**
 * How far (m) (lat, lon) is from where the recorded track was at unix ms `t`, as the former backfill_time.py `track_distance_m`.
 * Before the start or after the end, the track is where it started or ended; inside a gap where it moved, anywhere
 * on the straight line between the gap's ends.
 */
export function trackDistanceM(track: TrackPoint[], t: number, lat: number, lon: number): number {
	const first = track[0];
	const last = track[track.length - 1];
	if (t <= first.t) return haversineM({ lat, lon }, first);
	if (t >= last.t) return haversineM({ lat, lon }, last);
	const pos = gapAwarePositionAt(track, t);
	if (pos) return haversineM({ lat, lon }, pos);
	const i = after(track, t);
	return segmentDistanceM(lat, lon, track[i - 1], track[i]);
}

/** Badges of a post's photos, read from disk. A place doc has no route or recording: only `no time` / `no location`. */
export function photoBadges(root: string, ref: DocRef): Record<string, Badge[]> {
	if (ref.kind === 'place') return badges((readFrontmatterDoc(loadPlace(root, ref.slug).raw).doc.toJS() ?? {}) as any, [], null);
	if (ref.kind !== 'post') throw new ApiError(400, 'Photos belong to a post (a dated visit) or a place doc');
	const cur = loadDoc(root, ref.slug, ref.date);
	if (cur.postRaw === null) throw new ApiError(404, `No post ${ref.date}-${ref.slug}`);
	const front = (readFrontmatterDoc(cur.postRaw).doc.toJS() ?? {}) as any;
	return badges(front, recordedTrack(root, ref.slug, front), routeOf(root, ref.slug, front));
}

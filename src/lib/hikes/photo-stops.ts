/**
 * Where along the route each photo was taken: distance, altitude and time of
 * day, for the `km 13.4 · 2052 m · 11:18` line under its caption and its tick
 * on the elevation profile.
 *
 * Distance and altitude come from projecting the photo's `lat`/`lon` onto the
 * route's GeoJSON track, the same track and distance stretch the elevation
 * chart draws, so the two agree. The time is the photo's own `taken` (already
 * vetted by scripts/backfill_time.py), else the recorded GPX's time where it
 * passes the photo, else none.
 *
 * Framework-free and dependency-free, so it runs under plain Node for tests.
 */

import { haversineKm } from './hike-metrics';

export interface StopPhoto {
	/** The image's `data-media-index`; photos must be passed in reading order. */
	mediaIndex: number;
	lat?: number;
	lon?: number;
	/** Local wall-clock time with offset, e.g. `2026-09-27T11:18:16+02:00`. */
	taken?: string;
}

export interface TimedPoint {
	lat: number;
	lon: number;
	/** Unix milliseconds. */
	t: number;
}

export interface PhotoStop {
	/** Distance along the route (km, on the chart's scale). */
	km?: number;
	/** Track altitude there (m). */
	ele?: number;
	/** Local time of day, `HH:MM`. */
	time?: string;
	timeSource?: 'photo' | 'track';
	/** Set when the photo is on the track, so its caption line can center the map on it. */
	lat?: number;
	lon?: number;
}

/** Photos further than this from the track get no distance or altitude. */
const OFF_TRACK_KM = 0.3;
/** Places on the track within this much of the closest one count as candidates (out-and-back legs). */
const CANDIDATE_SLACK_KM = 0.05;
/** A photo may sit this far before the previous one in reading order and still keep the order. */
const ORDER_SLACK_KM = 0.2;

interface Candidate {
	/** Cumulative distance along the track, before any distance stretch. */
	along: number;
	/** Distance from the photo. */
	off: number;
	/** Index of the segment's first point and how far along the segment. */
	i: number;
	f: number;
}

/** [lon, lat] in degrees -> local flat x/y in km around `ref`. */
function flat(c: number[], ref: number[]): [number, number] {
	const k = Math.cos((ref[1] * Math.PI) / 180);
	return [((c[0] - ref[0]) * Math.PI * 6371 * k) / 180, ((c[1] - ref[1]) * Math.PI * 6371) / 180];
}

function cumulative(coords: number[][]): number[] {
	const out = [0];
	for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineKm(coords[i - 1], coords[i]));
	return out;
}

/**
 * The places on the track nearest to `p`, one per stretch of track that comes
 * that close (an out-and-back passes each spot twice), or [] if none is
 * within `OFF_TRACK_KM`.
 */
function candidates(coords: number[][], cum: number[], p: number[]): Candidate[] {
	const segs: Candidate[] = [];
	if (coords.length === 1) {
		segs.push({ along: 0, off: haversineKm(coords[0], p), i: 0, f: 0 });
	}
	for (let i = 0; i + 1 < coords.length; i++) {
		const [ax, ay] = flat(coords[i], p);
		const [bx, by] = flat(coords[i + 1], p);
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy;
		const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
		const off = Math.hypot(ax + dx * f, ay + dy * f);
		segs.push({ along: cum[i] + (cum[i + 1] - cum[i]) * f, off, i, f });
	}
	const best = Math.min(...segs.map((s) => s.off));
	if (!(best <= OFF_TRACK_KM)) return [];

	// Keep the closest segment of every run of consecutive close segments.
	const out: Candidate[] = [];
	let run: Candidate | null = null;
	let last = -2;
	for (const s of segs) {
		if (s.off > best + CANDIDATE_SLACK_KM) continue;
		if (run && s.i === last + 1) {
			if (s.off < run.off) run = s;
		} else {
			if (run) out.push(run);
			run = s;
		}
		last = s.i;
	}
	if (run) out.push(run);
	return out;
}

/** The candidate whose share of the way along is closest to `share` (0..1). */
function closestShare(cands: Candidate[], total: number, share: number): Candidate {
	return cands.reduce((a, b) => (Math.abs(b.along / total - share) < Math.abs(a.along / total - share) ? b : a));
}

/** Share of the recorded track's length covered by time `t`. */
function shareAtTime(track: TimedPoint[], cum: number[], t: number): number | null {
	if (track.length < 2 || t < track[0].t || t > track[track.length - 1].t) return null;
	let i = 1;
	while (i < track.length - 1 && track[i].t < t) i++;
	const span = track[i].t - track[i - 1].t;
	const f = span > 0 ? (t - track[i - 1].t) / span : 0;
	const total = cum[cum.length - 1];
	return total > 0 ? (cum[i - 1] + (cum[i] - cum[i - 1]) * f) / total : null;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** `HH:MM` of a `taken` value, read off the string so it stays the photo's own wall clock. */
export function takenClock(taken: string): string | null {
	const m = /T(\d{2}):(\d{2})/.exec(taken);
	return m ? `${m[1]}:${m[2]}` : null;
}

/** UTC offset in minutes of a `taken` value, or null. */
export function takenOffset(taken: string): number | null {
	const m = /([+-])(\d{2}):(\d{2})$/.exec(taken);
	if (!m) return null;
	return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** `HH:MM` of unix ms `t` at a fixed offset, or in Europe/Berlin without one. */
function clockAt(t: number, offsetMin: number | null): string {
	if (offsetMin != null) {
		const d = new Date(t + offsetMin * 60000);
		return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
	}
	return new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin'
	}).format(t);
}

/** The offset most of the post's photos were taken at, or null without any. */
function usualOffset(photos: StopPhoto[]): number | null {
	const counts = new Map<number, number>();
	for (const p of photos) {
		const o = p.taken ? takenOffset(p.taken) : null;
		if (o != null) counts.set(o, (counts.get(o) ?? 0) + 1);
	}
	let best: number | null = null;
	for (const [o, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = o;
	return best;
}

/**
 * @param coords The route's GeoJSON coordinates, `[lon, lat, ele?]`.
 * @param distanceFactor The elevation chart's distance stretch (`computeMetricScales`).
 * @param photos The post's photos in reading order.
 * @param track The recorded GPX trackpoints with times; [] for a planned route.
 * @returns mediaIndex -> stop, only for photos with anything to show.
 */
export function computePhotoStops(
	coords: number[][] | null | undefined,
	distanceFactor: number,
	photos: StopPhoto[],
	track: TimedPoint[]
): Map<number, PhotoStop> {
	const route = (coords ?? []).filter((c) => Array.isArray(c) && c.length >= 2);
	const cum = cumulative(route);
	const total = cum[cum.length - 1] ?? 0;
	const trackCoords = track.map((p) => [p.lon, p.lat]);
	const trackCum = cumulative(trackCoords);
	const trackTotal = trackCum[trackCum.length - 1] ?? 0;
	const offset = usualOffset(photos);

	// Legs of an out-and-back are told apart by the order photos were taken
	// in: by their times when every located photo has one, else reading order.
	const located = photos.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
	const ordered = located.length > 0 && located.every((p) => p.taken && Number.isFinite(Date.parse(p.taken)))
		? [...photos].sort((a, b) => (a.taken ? Date.parse(a.taken) : Infinity) - (b.taken ? Date.parse(b.taken) : Infinity))
		: photos;

	const stops = new Map<number, PhotoStop>();
	let prevAlong = -Infinity;
	for (const photo of ordered) {
		const stop: PhotoStop = {};
		const isLocated = typeof photo.lat === 'number' && typeof photo.lon === 'number';
		const takenMs = photo.taken ? Date.parse(photo.taken) : NaN;
		const takenShare = Number.isFinite(takenMs) ? shareAtTime(track, trackCum, takenMs) : null;

		let share: number | null = null;
		if (isLocated && route.length > 0 && total > 0) {
			const p = [photo.lon!, photo.lat!];
			const cands = candidates(route, cum, p);
			if (cands.length > 0) {
				let pick: Candidate;
				if (takenShare != null) {
					pick = closestShare(cands, total, takenShare);
				} else {
					const ahead = cands.filter((c) => c.along >= prevAlong - ORDER_SLACK_KM);
					pick = ahead.length > 0 ? ahead[0] : cands.reduce((a, b) => (b.off < a.off ? b : a));
				}
				prevAlong = pick.along;
				stop.lat = photo.lat;
				stop.lon = photo.lon;
				share = pick.along / total;
				stop.km = pick.along * distanceFactor;
				const a = route[pick.i][2];
				const b = route[Math.min(pick.i + 1, route.length - 1)][2];
				if (typeof a === 'number' && typeof b === 'number') stop.ele = a + (b - a) * pick.f;
			}
		}

		const clock = photo.taken ? takenClock(photo.taken) : null;
		if (clock) {
			stop.time = clock;
			stop.timeSource = 'photo';
		} else if (share != null && track.length > 1 && trackTotal > 0) {
			// When the recorded track passed the photo; on an out-and-back, the
			// pass at the same share of the way as the route position picked above.
			const tc = candidates(trackCoords, trackCum, [photo.lon!, photo.lat!]);
			if (tc.length > 0) {
				const c = closestShare(tc, trackTotal, share);
				const t = track[c.i].t + (track[Math.min(c.i + 1, track.length - 1)].t - track[c.i].t) * c.f;
				stop.time = clockAt(t, offset);
				stop.timeSource = 'track';
			}
		}

		if (stop.km != null || stop.time != null) stops.set(photo.mediaIndex, stop);
	}
	return stops;
}

/**
 * The stops back as a map, from the plain object the server load sends to the
 * browser (`Object.fromEntries`, so the keys arrive as strings).
 */
export function photoStopsFromRecord(record: Record<string, PhotoStop> | null | undefined): Map<number, PhotoStop> {
	return new Map(Object.entries(record ?? {}).map(([index, stop]) => [Number(index), stop]));
}

/** The caption line's text, e.g. `km 13.4 · 2052 m · 11:18`. */
export function photoStopText(stop: PhotoStop): string {
	const parts: string[] = [];
	if (stop.km != null) parts.push(`km ${stop.km.toFixed(1)}`);
	if (stop.ele != null) parts.push(`${Math.round(stop.ele)} m`);
	if (stop.time != null) parts.push(stop.time);
	return parts.join(' · ');
}

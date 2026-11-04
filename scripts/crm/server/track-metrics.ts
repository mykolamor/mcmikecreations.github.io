/**
 * Port of the former scripts/matches/track_metrics.py: distance (m, 3D), ascent/descent (m) and moving time (minutes)
 * from a recorded GPX track. Same constants and rules; the golden test compares against the Python output.
 */
const WINDOW_S = 60;
const MIN_SPEED_KMH = 0.5;
/** Trackpoints further apart than this are a recording gap. */
export const MAX_INTERVAL_S = 600;
const CLIMB_THRESHOLD_M = 2.0;

export type Point = { lat: number; lon: number; ele: number | null; time: number };

export type TrackMetrics = { distance: number; ascent?: number; descent?: number; duration: number };

/** Python's round(): halves go to the even neighbour. */
function pyRound(x: number): number {
	const f = Math.floor(x);
	const d = x - f;
	if (d < 0.5) return f;
	if (d > 0.5) return f + 1;
	return f % 2 === 0 ? f : f + 1;
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const r = Math.PI / 180;
	const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function readTrack(gpx: string): Point[] {
	const points: Point[] = [];
	for (const m of gpx.matchAll(/<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
		const lat = /lat="([^"]+)"/.exec(m[1]);
		const lon = /lon="([^"]+)"/.exec(m[1]);
		const time = /<time>([^<]+)<\/time>/.exec(m[2]);
		const ele = /<ele>([^<]+)<\/ele>/.exec(m[2]);
		if (lat && lon && time) {
			const t = Date.parse(time[1].trim()) / 1000;
			if (Number.isFinite(t)) points.push({ lat: +lat[1], lon: +lon[1], ele: ele ? +ele[1] : null, time: t });
		}
	}
	return points;
}

function movingMinutes(points: Point[]): number | null {
	if (points.length < 2) return null;
	let moving = 0;
	let lo = 0;
	let hi = 0;
	const n = points.length;
	for (let i = 0; i < n - 1; i++) {
		const dt = points[i + 1].time - points[i].time;
		if (dt <= 0 || dt > MAX_INTERVAL_S) continue;
		const t = points[i].time;
		while (points[lo].time < t - WINDOW_S / 2) lo++;
		while (hi < n - 1 && points[hi].time < t + WINDOW_S / 2) hi++;
		const span = points[hi].time - points[lo].time;
		if (span > 0 && (haversineM(points[lo], points[hi]) / span) * 3.6 >= MIN_SPEED_KMH) moving += dt;
	}
	return moving / 60;
}

function distanceM(points: Point[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const dz = a.ele !== null && b.ele !== null ? b.ele - a.ele : 0;
		total += Math.hypot(haversineM(a, b), dz);
	}
	return total;
}

function climbM(points: Point[]): [number, number] | null {
	const el = points.flatMap((p) => (p.ele === null ? [] : [p.ele]));
	if (el.length < 2) return null;
	let up = 0;
	let down = 0;
	let ref = el[0];
	for (const z of el.slice(1)) {
		if (z - ref >= CLIMB_THRESHOLD_M) {
			up += z - ref;
			ref = z;
		} else if (ref - z >= CLIMB_THRESHOLD_M) {
			down += ref - z;
			ref = z;
		}
	}
	return [up, down];
}

/** The four front-matter metrics, or null for an untimed (planned) track. Ascent/descent are absent without elevation. */
export function trackMetrics(gpxXml: string): TrackMetrics | null {
	const points = readTrack(gpxXml);
	const minutes = movingMinutes(points);
	if (minutes === null) return null;
	const out: TrackMetrics = { distance: pyRound(distanceM(points)), duration: pyRound(minutes) };
	const climb = climbM(points);
	if (climb) {
		out.ascent = pyRound(climb[0]);
		out.descent = pyRound(climb[1]);
	}
	return out;
}

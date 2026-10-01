/**
 * Route facts computed from a hike's track, the same way for every post: the
 * highest and lowest point, the route's shape, and a standard time estimate.
 *
 * Framework-free and browser-safe. Elapsed time needs the GPX file or front
 * matter and is resolved server-side (`hike-facts.server.ts`).
 */

import { haversineKm, type HikeMetrics } from '$lib/hikes/hike-metrics';

export type RouteType = 'loop' | 'out-and-back' | 'point-to-point';

export type ElapsedSource = 'gpx' | 'photos' | 'manual';

export interface HikeElapsed {
	minutes: number;
	/**
	 * `gpx`: first to last trackpoint of a recorded track. `photos`: first to
	 * last hand-picked photo, so only a lower bound. `manual`: set by hand.
	 */
	source: ElapsedSource;
}

export interface HikeFacts {
	/** Metres, straight from the track's elevations (DEM or GPS). */
	highPoint: number | null;
	lowPoint: number | null;
	routeType: RouteType | null;
	/** Minutes, DAV walking time without breaks. */
	typicalDuration: number | null;
	elapsed: HikeElapsed | null;
}

/** Start and end closer than this make a loop. */
const LOOP_GAP_KM = 0.3;
/** A second-half point this close to the first half counts as retraced. */
const RETRACE_KM = 0.075;
/** Share of the second half that has to be retraced for an out-and-back. */
const RETRACE_SHARE = 0.7;
/** Tracks are resampled to about this many points before the O(n²) retrace check. */
const RETRACE_SAMPLES = 600;

/**
 * Walking time by the DAV (German Alpine Club) rule of thumb, in minutes:
 * 300 m of ascent or 500 m of descent per hour vertically, 4 km per hour
 * horizontally; the larger of the two plus half the smaller. Breaks are not
 * included, same as the times on German trail signs.
 */
export function davDuration(distanceM: number, ascentM: number, descentM: number): number {
	const vertical = ascentM / 300 + descentM / 500;
	const horizontal = distanceM / 1000 / 4;
	const hours = Math.max(vertical, horizontal) + Math.min(vertical, horizontal) / 2;
	return hours * 60;
}

/** Roughly evenly spaced points along the track, by distance. */
function resample(coords: number[][], count: number): number[][] {
	if (coords.length <= count) return coords;
	const cumulative = [0];
	for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i - 1] + haversineKm(coords[i - 1], coords[i]));
	const total = cumulative[cumulative.length - 1];
	const out: number[][] = [];
	let j = 0;
	for (let k = 0; k < count; k++) {
		const target = (total * k) / (count - 1);
		while (j < coords.length - 1 && cumulative[j] < target) j++;
		out.push(coords[j]);
	}
	return out;
}

export function classifyRoute(coords: number[][]): RouteType | null {
	if (coords.length < 2) return null;

	const points = resample(coords, RETRACE_SAMPLES);
	const half = Math.floor(points.length / 2);
	const first = points.slice(0, half);
	const second = points.slice(half);
	const retraced = second.filter((p) => first.some((q) => haversineKm(p, q) <= RETRACE_KM)).length;
	if (second.length > 0 && retraced / second.length >= RETRACE_SHARE) return 'out-and-back';

	const gap = haversineKm(coords[0], coords[coords.length - 1]);
	return gap <= LOOP_GAP_KM ? 'loop' : 'point-to-point';
}

/**
 * Facts derivable from the track and the authoritative metrics alone.
 * `elapsed` is left null for the server to fill in.
 */
export function computeHikeFacts(
	coords: number[][] | null | undefined,
	metrics: Partial<HikeMetrics> | null | undefined
): HikeFacts {
	let highPoint: number | null = null;
	let lowPoint: number | null = null;
	let routeType: RouteType | null = null;

	const track = (coords ?? []).filter((c) => Array.isArray(c) && c.length >= 2);
	if (track.length > 1) {
		routeType = classifyRoute(track);

		const elevations = track.map((c) => c[2]).filter((z): z is number => typeof z === 'number' && Number.isFinite(z));
		if (elevations.length > 0) {
			// Raw, not scaled to the stated ascent/descent like the chart labels:
			// that scaling keeps the vertical travel right but moves the summit,
			// e.g. Zugspitze (2962 m) would read 2129 m.
			// reduce, not Math.max(...): recorded tracks run to 30k+ points.
			highPoint = Math.round(elevations.reduce((a, b) => (b > a ? b : a)));
			// GPS noise puts coastal hikes a metre or two below sea level.
			lowPoint = Math.max(0, Math.round(elevations.reduce((a, b) => (b < a ? b : a))));
		}
	}

	const { distance, ascent, descent } = metrics ?? {};
	const typicalDuration =
		distance != null && ascent != null && descent != null ? davDuration(distance, ascent, descent) : null;

	return { highPoint, lowPoint, routeType, typicalDuration, elapsed: null };
}

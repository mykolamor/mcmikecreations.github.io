/**
 * The home page hero map's candidate hikes, worked out at build time: which
 * hikes have enough peaks inside their heightmap (scripts/hero_heightmaps.py),
 * and which of those peaks the nav labels point at. Pure, so the server module
 * and the tests share it; the browser half lives in src/lib/hero-map/.
 */
import type { Map, MapNode } from '../data/map-info';
import { defaultMetaPath, hikeSlug } from '../data/hikes-core.js';

export const HERO_FOLDER = '/_projects/data-viz/hikes/hero';
/**
 * The candidate list reaches the home page once: the server hook swaps this
 * placeholder for the JSON on a full page load (for the head's boot script),
 * and client-side navigation to Home fetches the prerendered copy instead.
 */
export const HERO_CANDIDATES_PLACEHOLDER = '%%HERO_MAP_CANDIDATES%%';
export const HERO_CANDIDATES_URL = '/hero-map.json';

/** The candidate list as JSON that is safe inside a <script> element. */
export const candidatesScriptJson = (candidates: HeroCandidate[]) => JSON.stringify(candidates).replace(/</g, '\\u003c');

export interface HeroBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface HeroMeta extends HeroBounds {
	minEle: number;
	maxEle: number;
}

export interface HeroPeak {
	name: string;
	lat: number;
	lon: number;
	ele: number;
}

export interface HeroCandidate {
	slug: string;
	/** The hike's name, for the hero's link to it. */
	name: string;
	/** The hike's newest blog post, or its map page when it has none. */
	href: string;
	heightmap: string;
	route: string;
	bounds: HeroBounds;
	minEle: number;
	maxEle: number;
	peaks: HeroPeak[];
}

export interface Point {
	x: number;
	y: number;
}

const EARTH_RADIUS = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `count` peaks spread as far apart as possible: the highest first, then
 * repeatedly the one farthest from everything chosen so far.
 */
export function selectPeaks(peaks: HeroPeak[], count: number): HeroPeak[] {
	if (peaks.length <= count) return [...peaks];
	const rest = [...peaks];
	const first = rest.reduce((best, p, i) => (p.ele > rest[best].ele ? i : best), 0);
	const chosen = rest.splice(first, 1);
	while (chosen.length < count) {
		let bestIndex = 0;
		let bestDistance = -1;
		rest.forEach((p, i) => {
			const d = Math.min(...chosen.map((c) => haversine(c, p)));
			if (d > bestDistance) {
				bestDistance = d;
				bestIndex = i;
			}
		});
		chosen.push(...rest.splice(bestIndex, 1));
	}
	return chosen;
}

const insideBounds = (b: HeroBounds) => (n: { lat: number; lon: number }) =>
	n.lat >= b.south && n.lat <= b.north && n.lon >= b.west && n.lon <= b.east;

function nodeEle(n: MapNode): number {
	if (typeof n.demEle === 'number') return n.demEle;
	const tagged = parseFloat(n.tags.ele ?? '');
	return Number.isFinite(tagged) ? tagged : 0;
}

/** The sidecar a hike reads, as the heightmap script names its outputs. */
function sidecarStem(hike: Map): string {
	const path = hike.properties.metaPath ?? defaultMetaPath(hikeSlug(hike.route));
	return path.slice(path.lastIndexOf('/') + 1).replace(/\.hike\.json$/, '');
}

/** Every hike the hero can show, each with `count` well-spread peaks inside its heightmap. */
export function buildCandidates(hikes: Map[], metas: Record<string, HeroMeta>, count: number): HeroCandidate[] {
	const candidates: HeroCandidate[] = [];
	for (const hike of hikes) {
		if (hike.properties.draft || hike.properties.hidden) continue;
		const stem = sidecarStem(hike);
		const meta = metas[stem];
		if (!meta) continue;
		const bounds: HeroBounds = { west: meta.west, south: meta.south, east: meta.east, north: meta.north };
		const peaks = (hike.properties.nodes ?? [])
			.filter((n) => n.tags.natural === 'peak')
			.filter(insideBounds(bounds))
			.map((n) => ({ name: n.tags.name ?? '', lat: n.lat, lon: n.lon, ele: nodeEle(n) }));
		if (peaks.length < count) continue;
		const slug = hikeSlug(hike.route);
		// Dates are newest first; only dates with a post have a page under /hikes/.
		const post = hike.properties.dates.find((d) => d.path);
		candidates.push({
			slug,
			name: hike.name,
			href: post ? `/hikes/${post.date}-${slug}/` : hike.route,
			heightmap: `${HERO_FOLDER}/${stem}.webp`,
			route: hike.properties.filePath,
			bounds,
			minEle: meta.minEle,
			maxEle: meta.maxEle,
			peaks: selectPeaks(peaks, count)
		});
	}
	return candidates;
}

/** The smallest of 25/50/100/200 m that draws at most 30 lines over the range. */
export function contourInterval(minEle: number, maxEle: number): number {
	const range = Math.max(0, maxEle - minEle);
	return [25, 50, 100, 200].find((step) => range / step <= 30) ?? 200;
}

function permutations(n: number): number[][] {
	if (n === 0) return [[]];
	return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

const pairingCost = (labels: Point[], peaks: Point[], pairing: number[]) =>
	pairing.reduce((sum, p, i) => sum + Math.hypot(labels[i].x - peaks[p].x, labels[i].y - peaks[p].y), 0);

/** For each label, the index of its peak: the pairing with the least total screen distance. */
export function assignLabels(labels: Point[], peaks: Point[]): number[] {
	let best: number[] = labels.map((_, i) => i);
	let bestCost = Infinity;
	for (const perm of permutations(labels.length)) {
		const cost = pairingCost(labels, peaks, perm);
		if (cost < bestCost) {
			bestCost = cost;
			best = perm;
		}
	}
	return best;
}

/**
 * Camera distance at which a sphere of `radius` fits the view whatever the
 * camera's direction: inside the tighter of the horizontal angle and the
 * vertical one, the latter cut to `visibleFraction` of the screen height
 * (the part not covered by the hero's text).
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, visibleFraction: number): number {
	const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
	const half = Math.min(Math.atan(tanHalf * visibleFraction), Math.atan(tanHalf * aspect));
	return radius / Math.sin(half);
}

/**
 * The smallest distance in [lo, hi] for which `fits` holds, by bisection.
 * `fits` must be monotonic (once it fits, farther fits too); `hi` is returned
 * when nothing smaller does, so pass a bound known to fit.
 */
export function smallestFit(fits: (distance: number) => boolean, lo: number, hi: number, iterations = 24): number {
	for (let i = 0; i < iterations; i++) {
		const mid = (lo + hi) / 2;
		if (fits(mid)) hi = mid;
		else lo = mid;
	}
	return hi;
}

const orientation = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) =>
	orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
const pairingCrosses = (labels: Point[], peaks: Point[], pairing: number[]) =>
	pairing.some((p, i) => pairing.some((q, j) => j > i && segmentsCross(labels[i], peaks[p], labels[j], peaks[q])));

/**
 * A better pairing for the orbiting map, or null to keep `current`: the
 * shortest pairing (which never crosses) when the current one has crossing
 * lines, or when it is at least `gain` shorter in total. The margin keeps the
 * lines from flickering between two near-equal, uncrossed pairings.
 */
export function reassignLabels(labels: Point[], peaks: Point[], current: number[], gain = 0.03): number[] | null {
	const best = assignLabels(labels, peaks);
	if (best.every((p, i) => p === current[i])) return null;
	if (pairingCrosses(labels, peaks, current)) return best;
	return pairingCost(labels, peaks, best) < (1 - gain) * pairingCost(labels, peaks, current) ? best : null;
}

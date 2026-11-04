type Pt = { lat: number; lon: number };

const METRES_PER_DEGREE = 111194.9266;

export function distanceM(a: Pt, b: Pt): number {
	const cos = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
	return Math.hypot((b.lat - a.lat) * METRES_PER_DEGREE, (b.lon - a.lon) * METRES_PER_DEGREE * cos);
}

/** The candidate nearest `point` within `radiusM` (equirectangular metres); ties go to the earlier one. */
export function snap<T extends Pt>(point: Pt, candidates: T[], radiusM = 30): T | null {
	let best: T | null = null;
	let bestD = Infinity;
	for (const c of candidates) {
		const d = distanceM(point, c);
		if (d <= radiusM && d < bestD) {
			best = c;
			bestD = d;
		}
	}
	return best;
}

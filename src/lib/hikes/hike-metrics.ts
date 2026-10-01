/**
 * Shared, framework-free helpers for the four hike metrics
 * (distance, duration, ascent, descent).
 *
 * Canonical units used everywhere in the app:
 *   - distance : metres
 *   - duration : minutes
 *   - ascent   : metres
 *   - descent  : metres
 *
 * The GeoJSON source stores distance in km and duration in seconds, so those
 * are converted here. Any of the four may be overridden per-hike in
 * hikes.json under `properties`; an override always wins over the GeoJSON
 * value. Keep this the single place that encodes both the unit conversion and
 * the override precedence so the plots, stat cards, JSON-LD and the /hikes/tag/Web/
 * summary all agree.
 */

export interface HikeMetrics {
	distance: number | null; // metres
	duration: number | null; // minutes
	ascent: number | null; // metres
	descent: number | null; // metres
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoProps = { summary?: { distance?: number; duration?: number }; ascent?: number; descent?: number } | null | undefined;

/**
 * Merge a hike's override properties with the GeoJSON feature properties,
 * returning the four metrics in canonical units. Override (non-null) wins;
 * otherwise the GeoJSON value is converted; otherwise null.
 */
export function mergeMetrics(override: Partial<HikeMetrics> | null | undefined, geo: GeoProps): HikeMetrics {
	const summary = geo?.summary;
	return {
		distance: override?.distance ?? (summary?.distance != null ? summary.distance * 1000 : null),
		duration: override?.duration ?? (summary?.duration != null ? summary.duration / 60 : null),
		ascent: override?.ascent ?? geo?.ascent ?? null,
		descent: override?.descent ?? geo?.descent ?? null
	};
}

export function haversineKm(c1: number[], c2: number[]): number {
	const R = 6371;
	const φ1 = (c1[1] * Math.PI) / 180;
	const φ2 = (c2[1] * Math.PI) / 180;
	const Δφ = ((c2[1] - c1[1]) * Math.PI) / 180;
	const Δλ = ((c2[0] - c1[0]) * Math.PI) / 180;
	const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface MetricScales {
	/** multiply a coordinate-derived (haversine) distance by this to reach the authoritative distance */
	distanceFactor: number;
}

/**
 * Compute the factor that maps the raw GeoJSON coordinate track onto the
 * authoritative (possibly overridden) distance, so the elevation chart's
 * x-axis reads in the same distance as the stat card.
 *
 * Elevations are deliberately not scaled. Stretching the track's vertical
 * excursions to match the stated ascent/descent kept the totals consistent
 * but moved every absolute height: Zugspitze via Reintal topped out at
 * 2129 m instead of 2962 m. The track's own elevations are within ~30 m of
 * the real summits, so they are shown as they are.
 */
export function computeMetricScales(
	coords: number[][],
	authoritative?: Partial<HikeMetrics> | null
): MetricScales {
	if (!coords?.length) return { distanceFactor: 1 };

	let haversineTotal = 0;
	for (let i = 1; i < coords.length; i++) haversineTotal += haversineKm(coords[i - 1], coords[i]);

	const authDistanceKm = authoritative?.distance != null ? authoritative.distance / 1000 : null;
	const distanceFactor = authDistanceKm != null && haversineTotal > 0 ? authDistanceKm / haversineTotal : 1;
	return { distanceFactor };
}

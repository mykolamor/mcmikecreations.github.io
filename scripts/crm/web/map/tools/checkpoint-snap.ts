import { snap } from '../../../shared/snap';

type Pt = { lat: number; lon: number };
export type SnapSource = {
	others: { name: string; checkpoints: [number, number][] }[];
	nodes: { ref: string; name: string | null; lat: number; lon: number }[];
};
export type StoreItem = { ref: string; name: string | null; lat: number; lon: number };
export type Resolved = { lon: number; lat: number; label: string | null };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Snap tiers in priority order: another hike's checkpoint, this hike's node, any store element; within `radiusM` (30). */
export function resolveCheckpoint(point: Pt, src: SnapSource, store: StoreItem[], radiusM = 30): Resolved {
	const checkpoints = src.others.flatMap((o) => o.checkpoints.map(([lon, lat]) => ({ lat, lon, label: `${o.name} checkpoint` })));
	const named = (list: { ref: string; name: string | null; lat: number; lon: number }[]) => list.map((n) => ({ lat: n.lat, lon: n.lon, label: n.name ?? n.ref }));
	for (const tier of [checkpoints, named(src.nodes), named(store)]) {
		const hit = snap(point, tier, radiusM);
		if (hit) return { lon: hit.lon, lat: hit.lat, label: hit.label };
	}
	return { lon: round6(point.lon), lat: round6(point.lat), label: null };
}

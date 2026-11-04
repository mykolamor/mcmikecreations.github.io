// The open screen's hike list order: by the sidecar's English name, by slug, or newest visit first.

export type HikeSort = 'name' | 'slug' | 'visit';
export const HIKE_SORTS: { value: HikeSort; label: string }[] = [
	{ value: 'name', label: 'Name' },
	{ value: 'slug', label: 'Slug' },
	{ value: 'visit', label: 'Latest visit' }
];
export const HIKE_SORT_KEY = 'crm.hikeSort';

export const isHikeSort = (v: unknown): v is HikeSort => HIKE_SORTS.some((s) => s.value === v);

type Sortable = { slug: string; name: string; posts: { date: string }[]; postlessDates: string[] };

/** The newest date among the hike's posts and its post-less visits, `''` when it has none. */
export function latestVisit(h: Sortable): string {
	let best = '';
	for (const d of [...h.posts.map((p) => p.date), ...h.postlessDates]) if (d > best) best = d;
	return best;
}

/**
 * A sorted copy. `visit` puts the newest visit first and hikes without any visit last; ties (and `name`) fall back to
 * the name, then the slug.
 */
export function sortHikes<T extends Sortable>(hikes: readonly T[], by: HikeSort): T[] {
	const byName = (a: T, b: T) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
	if (by === 'slug') return [...hikes].sort((a, b) => a.slug.localeCompare(b.slug));
	if (by === 'name') return [...hikes].sort(byName);
	const latest = new Map(hikes.map((h) => [h, latestVisit(h)]));
	return [...hikes].sort((a, b) => latest.get(b)!.localeCompare(latest.get(a)!) || byName(a, b));
}

/**
 * The hero map's candidate hikes, assembled at build time from the hike
 * database and the heightmap metadata scripts/hero_heightmaps.py writes.
 * Server-only (it pulls in hikes.server); the home page inlines the result.
 */
import { hikes } from '$lib/hikes/hikes.server';
import { heroNavItems } from '$lib/data/nav';
import { buildCandidates, type HeroCandidate, type HeroMeta } from '$lib/hikes/hero-map';

const files = import.meta.glob('/static/_projects/data-viz/hikes/hero/*.json', {
	eager: true,
	import: 'default'
}) as Record<string, HeroMeta>;

const metas: Record<string, HeroMeta> = Object.fromEntries(
	Object.entries(files).map(([path, meta]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), meta])
);

export const heroCandidates: HeroCandidate[] = buildCandidates(hikes, metas, heroNavItems.length);

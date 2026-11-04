import { getAllPosts, getPosts } from '$lib/hikes/hikes-info.server';
import { error } from '@sveltejs/kit';
import { hikes, resolveHikeForPost } from '$lib/hikes/hikes.server';
import type { Map as HikeMap, GeometryData } from '$lib/data/map-info';
import { getMapFeatures } from '$lib/data/map-info';
import { providerFolder } from '$lib/data/map-providers';
import { mergeMetrics } from '$lib/hikes/hike-metrics';
import { t } from '$lib/i18n/strings';

export const prerender = true;

export function entries() {
    const posts = getAllPosts();
    const tags = [...new Set(posts.flatMap(p => p.tags))];
    return tags.map(tag => ({ tag }));
}

type WeekHike = { name: string; route: string; hasBlog: boolean };
export type WeekData = { year: number; weekIndex: number; label: string; hikes: WeekHike[] };
export type WebStats = {
    totalDistance: number;
    totalTime: number;
    totalHikes: number;
    totalAscent: number;
    totalDescent: number;
};
export type HikeStats = { distance: number | null; duration: number | null; ascent: number | null; descent: number | null };
export type WebData = { stats: WebStats; weeks: WeekData[]; hikeStats: Record<string, HikeStats> };

function getYearWeeks(year: number): WeekData[] {
    const weeks: WeekData[] = [];
    for (let i = 0; i < 53; i++) {
        const wStart = new Date(Date.UTC(year, 0, 1 + i * 7));
        const wEnd = new Date(Math.min(Date.UTC(year, 0, 1 + i * 7 + 6), Date.UTC(year, 11, 31)));
        if (wStart.getUTCFullYear() > year) break;
        const startStr = wStart.toISOString().split('T')[0];
        const endStr = wEnd.toISOString().split('T')[0];
        weeks.push({ year, weekIndex: i, label: t('en', 'web.weekLabel', { start: startStr, end: endStr }), hikes: [] });
    }
    return weeks;
}

async function fetchGeometry(fetchFn: typeof fetch, layerData: GeometryData): Promise<any> {
    if (!layerData.path) return null;
    const sepIdx = layerData.path.indexOf('#');
    const filePath = layerData.path.slice(0, sepIdx);
    const res = await fetchFn(`/${providerFolder}/${layerData.provider}/${filePath}`);
    const json = await res.json();
    return layerData.path.slice(sepIdx + 2).split('/').reduce((o: any, k: string) => o[k], json);
}

async function computeWebData(fetchFn: typeof fetch): Promise<WebData> {
    const maps = hikes as unknown as HikeMap[];

    // Build timeline weeks
    const yearsData = new Map<number, WeekData[]>();
    for (const hike of maps) {
        if (hike.properties?.draft === true || (hike.properties as any)?.hidden === true) continue;
        for (const dateObj of hike.properties.dates) {
            const dateStr = dateObj.date;
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(5, 7)) - 1;
            const day = parseInt(dateStr.substring(8, 10));
            if (!yearsData.has(year)) yearsData.set(year, getYearWeeks(year));
            const d = new Date(Date.UTC(year, month, day));
            const startOfYear = new Date(Date.UTC(year, 0, 1));
            const weekIndex = Math.floor((d.getTime() - startOfYear.getTime()) / (86400000 * 7));
            const filename = dateObj.path ? dateObj.path.split('/').pop()?.replace('.md', '') : null;
            const targetRoute = filename ? `/hikes/${filename}/` : `${hike.route}/`;
            const weeks = yearsData.get(year)!;
            if (weeks[weekIndex]) {
                weeks[weekIndex].hikes.push({ name: hike.name, route: targetRoute, hasBlog: !!dateObj.path });
            }
        }
    }
    const allWeeks: WeekData[] = [];
    for (const year of [...yearsData.keys()].sort((a, b) => a - b)) {
        allWeeks.push(...yearsData.get(year)!);
    }

    // Compute stats and per-hike properties by fetching geometry files in parallel.
    // Measured per date, not per hike: a post's front matter can pin its own
    // metrics or point at its own geometry, so sibling dates on one route need
    // not agree. With uniform dates this is the same as one hike's figures times
    // its date count, which is what it used to be.
    let totalDistance = 0, totalTime = 0, totalHikes = 0, totalAscent = 0, totalDescent = 0;
    const hikeStats: Record<string, { distance: number | null; duration: number | null; ascent: number | null; descent: number | null }> = {};
    await Promise.all(
        maps
            .filter(m => (m.properties as any)?.hidden !== true)
            .map(async (mapInfo) => {
                const p = mapInfo.properties;
                const measured = (await Promise.all(
                    [...p.dates]
                        .sort((a, b) => (a.date > b.date ? -1 : 1))
                        .map(async (dateObj) => {
                            const { hike, properties } = resolveHikeForPost(mapInfo, dateObj);
                            const layer = getMapFeatures({ ...hike, properties } as any)
                                .find((x: any) => x.type === 'Geometry');
                            if (!layer) return null;
                            try {
                                const geo = await fetchGeometry(fetchFn, layer.data as GeometryData);
                                if (!geo) return null;
                                return mergeMetrics(properties, geo.properties);
                            } catch {
                                // geometry unavailable, skip this date
                                return null;
                            }
                        })
                )).filter((m): m is NonNullable<typeof m> => m !== null);

                if (measured.length === 0) return;
                // The Web graph shows one figure per route: its newest date's.
                hikeStats[mapInfo.route] = measured[0];
                if (p.draft !== true) {
                    for (const m of measured) {
                        totalHikes += 1;
                        totalDistance += m.distance ?? 0;
                        totalTime += m.duration ?? 0;
                        totalAscent += m.ascent ?? 0;
                        totalDescent += m.descent ?? 0;
                    }
                }
            })
    );

    return {
        stats: { totalDistance, totalTime, totalHikes, totalAscent, totalDescent },
        weeks: allWeeks,
        hikeStats
    };
}

export async function load({ params, fetch }) {
    const tag = decodeURIComponent(params.tag);
    const { posts, pagination } = getPosts({ page: 1, tag });

    if (posts.length === 0) {
       throw error(404, 'Tag not found or no posts');
    }

    const base = {
        posts,
        pagination,
        tag,
        showPeople: false,
        header: { fixedNavbar: true }
    };

    if (tag === 'Web') {
        const webData = await computeWebData(fetch);
        return { ...base, webData };
    }

    return base;
}
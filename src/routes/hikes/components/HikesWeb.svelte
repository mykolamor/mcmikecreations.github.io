<script lang="ts">
import { Heading, Progressbar, Button } from 'flowbite-svelte';
import { ClockOutline, MapPinOutline, ArrowUpOutline, ArrowDownOutline, TrackingOutline } from 'flowbite-svelte-icons';
import 'leaflet/dist/leaflet.css';
import { getDistance, getTime } from '$lib/hikes/build-statistics';
import type { Layer } from 'leaflet';
import type { Feature, GeoJsonObject, Geometry } from 'geojson';
import HikesTimeline from './HikesTimeline.svelte';
import { primaryGeometryColor } from '$lib/hikes/build-geometry';
import { type MapDate } from '$lib/data/map-info';
import { getNodeIconDetails, nodeName, nodePopupHtml } from '$lib/hikes/map-utils';
import { addRegionPane, regionLayer, type RegionKind } from '$lib/hikes/region-overlay';
import { onMount } from 'svelte';
import { paragraphTexts, t, tHtml } from '$lib/i18n/strings';

type WeekHike = { name: string; route: string; hasBlog: boolean };
type WeekData = { year: number; weekIndex: number; label: string; hikes: WeekHike[] };
type WebStats = {
	totalDistance: number;
	totalTime: number;
	totalHikes: number;
	totalAscent: number;
	totalDescent: number;
};
type HikeStats = { distance: number | null; duration: number | null; ascent: number | null; descent: number | null };
type PeakNode = { ref: string; lat: number; lon: number; tags: Record<string, string> };
type Peak = { node: PeakNode; name: string | null; elevation: number | null; color: string; emoji: string };

interface Props {
	webData: { stats: WebStats; weeks: WeekData[]; hikeStats: Record<string, HikeStats> };
}

let { webData }: Props = $props();

// Shown as text in one `<p>`, so the prerendered HTML has no `{@html}` markers.
const intro = paragraphTexts('en', 'tags.Web.intro');

let loadingProgress = $state(0);
let isLoading = $state(true);
let hasStartedLoading = $state(false);

let peaks = $state<Peak[]>([]);
let selectedPeakId = $state<any>(null);

let leaflet: any = null;
let mapInstance: any = null;
let rerenderNodes: (() => void) | null = null;

function nodeElevation(tags: Record<string, string>): number | null {
    const raw = tags.ele;
    if (raw === undefined || raw === null) return null;
    const parsed = Number.parseFloat(String(raw).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

const formatElevation = (elevation: number) => t('en', 'web.elevation', { value: Math.round(elevation).toLocaleString('en-US') });

function focusPeak(peak: Peak) {
    if (!leaflet || !mapInstance) return;

    selectedPeakId = peak.node.ref;
    const latlng: [number, number] = [peak.node.lat, peak.node.lon];
    mapInstance.setView(latlng, Math.max(mapInstance.getZoom(), 13), { animate: false });
    rerenderNodes?.();

    leaflet.popup({ maxWidth: 300 })
        .setLatLng(latlng)
        .setContent(nodePopupHtml(peak.node.tags))
        .openOn(mapInstance);

    if (window.matchMedia('(max-width: 767px)').matches) {
        document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/// blended Catmull-Rom cubic spline
function smoothCoords(pts: number[][], pointsPerSegment = 10, smoothing = 0.5): number[][] {
    if (pts.length < 2) return pts;
    const result: number[][] = [];

    for (let i = 0; i < pts.length - 1; i++) {
        let p0 = i === 0 ? pts[i] : pts[i - 1];
        let p1 = pts[i];
        let p2 = pts[i + 1];
        let p3 = i + 2 < pts.length ? pts[i + 2] : p2;

        let m1_c = (p2[0] - p0[0]) / 2;
        let m1_cy = (p2[1] - p0[1]) / 2;
        let m2_c = (p3[0] - p1[0]) / 2;
        let m2_cy = (p3[1] - p1[1]) / 2;

        if (i === 0) {
            m1_c = p2[0] - p1[0];
            m1_cy = p2[1] - p1[1];
        }
        if (i === pts.length - 2) {
            m2_c = p2[0] - p1[0];
            m2_cy = p2[1] - p1[1];
        }

        let m1_l = p2[0] - p1[0];
        let m1_ly = p2[1] - p1[1];
        let m2_l = p2[0] - p1[0];
        let m2_ly = p2[1] - p1[1];

        let m1_x = m1_l * (1 - smoothing) + m1_c * smoothing;
        let m1_y = m1_ly * (1 - smoothing) + m1_cy * smoothing;
        let m2_x = m2_l * (1 - smoothing) + m2_c * smoothing;
        let m2_y = m2_ly * (1 - smoothing) + m2_cy * smoothing;

        for (let j = 0; j < pointsPerSegment; j++) {
            let t = j / pointsPerSegment;
            let t2 = t * t;
            let t3 = t2 * t;

            let h00 = 2 * t3 - 3 * t2 + 1;
            let h10 = t3 - 2 * t2 + t;
            let h01 = -2 * t3 + 3 * t2;
            let h11 = t3 - t2;

            let x = h00 * p1[0] + h10 * m1_x + h01 * p2[0] + h11 * m2_x;
            let y = h00 * p1[1] + h10 * m1_y + h01 * p2[1] + h11 * m2_y;

            result.push([x, y]);
        }
    }

    result.push(pts[pts.length - 1]);

    return result;
}

function hash(str: string): number {
    let hash = 0, i, chr;
    if (str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash;
}

async function startLoading() {
    hasStartedLoading = true;
    const { hikes: maps } = await (await fetch('/hikes/index.json')).json();

    const features: object[] = [];
    const mapsToProcess = (maps as any[]).filter(mapInfo => mapInfo.properties?.hidden !== true);
    const totalMaps = mapsToProcess.length;

    for (let i = 0; i < mapsToProcess.length; i++) {
        const mapInfo = mapsToProcess[i];
        const { checkpoints, ...props } = mapInfo.properties as any;
        if (!checkpoints) continue;

        const hikeProps = webData.hikeStats[mapInfo.route];
        const sharedProperties = {
            ...props,
            id: hash(mapInfo.route),
            route: mapInfo.route,
            distance: hikeProps?.distance ?? null,
            duration: hikeProps?.duration ?? null,
            ascent: hikeProps?.ascent ?? null,
            descent: hikeProps?.descent ?? null,
        };
        const smoothed = smoothCoords(checkpoints, 10, 0.4);

        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: smoothed },
            properties: { ...sharedProperties, isSmoothedOutline: true, isSmoothed: false },
        });
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: smoothed },
            properties: { ...sharedProperties, isSmoothed: true },
        });

        loadingProgress = Math.round(((i + 1) / totalMaps) * 100);
    }

    const { L } = await import('$lib/components/leaflet.almostover.js');
    leaflet = L;
    const map = L.map('map', {
        almostOnMouseMove: false,
        almostDistance: 15,
    } as any).setView([47.694653017305036, 11.799241670256336], 10);
    mapInstance = map;

    const isStatic = {
        isStatic: false,
        toggle: function() { this.isStatic = !this.isStatic; return this.isStatic; }
    }

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const randomColor = function(feature: Feature<Geometry, any> | undefined) {
        if (feature?.properties?.isSmoothedOutline) {
            return {
                color: '#ffffff',
                weight: 7,
                opacity: 0.9,
                dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
            };
        }
        const c = '#' + ((feature?.properties?.id ?? 0) & 0x00FFFFFF).toString(16).padStart(6, '0');
        if (feature?.properties?.isSmoothed) {
            return {
                color: c,
                weight: 4,
                opacity: 1.0,
                dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
            };
        }
        return {
            color: c,
            dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
        }
    };
    const staticColor = function(feature: Feature<Geometry, any> | undefined) {
        if (feature?.properties?.isSmoothedOutline) {
            return {
                color: '#ffffff',
                weight: 7,
                opacity: 0.9,
                dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
            };
        }
        if (feature?.properties?.isSmoothed) {
            return {
                color: primaryGeometryColor,
                weight: 4,
                opacity: 1.0,
                dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
            };
        }
        return {
            color: primaryGeometryColor,
            weight: 3,
            opacity: 0.8,
            dashArray: feature?.properties?.draft === true ? '5, 5' : undefined,
        };
    }

    const hikesLayer = L.geoJSON(features as GeoJsonObject[], {
        style: isStatic.isStatic ? staticColor : randomColor,
        onEachFeature: function(feature: Feature<any, any>, layer: Layer) {
            if (feature.properties) {
                const gpxLinks = (feature.properties.dates || [])
                    .filter((x: any) => x.gpx)
                    .map((x: any, i: number) => `<a href="${x.gpx}">${tHtml('en', 'web.popup.gpx', { n: i + 1 })}</a>`);
                const gpxSuffix = gpxLinks.length > 0 ? `, ${gpxLinks.join(', ')}` : '';
                layer.bindPopup(
`<ul>
<li>${tHtml('en', 'web.popup.distance', { value: getDistance(feature.properties.distance ?? 0) })}</li>
<li>${tHtml('en', 'web.popup.duration', { value: getTime(feature.properties.duration ?? 0) })}</li>
<li>${tHtml('en', 'web.popup.ascent', { value: getDistance(feature.properties.ascent ?? 0) })}</li>
<li>${tHtml('en', 'web.popup.descent', { value: getDistance(feature.properties.descent ?? 0) })}</li>
<li>${tHtml('en', 'web.popup.posts', { links: feature.properties.dates.map((x: MapDate) => {
    const filename = x.path ? x.path!.split('/').pop()!.replace('.md', '') : null;
    const targetRoute = filename ? `/hikes/${filename}/` : feature.properties.route;
    return `<a href="${targetRoute}">${new Date(x.date).toLocaleDateString('en-us', { year:"numeric", month:"short", day:"numeric"})}` + `</a>`;
}).join('; ') })}</li>
<li>${feature.properties.dates.map((x: MapDate) => !!x.path).includes(true) ? '' : `<a href="${feature.properties.route}/">${tHtml('en', 'web.popup.mapLink')}</a>, `}
<a href="${feature.properties.filePath}">${tHtml('en', 'web.popup.geojson')}</a>${gpxSuffix}
</li>
</ul>`);
            }
        }
    }).addTo(map);

    let nodesData: any[] = [];
    (maps as any[]).forEach(m => {
        if (m.properties?.hidden !== true && m.properties?.nodes) {
            m.properties.nodes.forEach((node: any) => {
                nodesData.push(node);
            });
        }
    });

    const uniqueNodes = Array.from(new Map(nodesData.map(node => [node.ref, node])).values());
    const nodesLayer = L.layerGroup().addTo(map);

    peaks = uniqueNodes
        .filter(node => node.tags?.natural === 'peak' && node.tags.visited !== 'no' && node.tags.visited !== 'missing')
        .map(node => {
            const tags = node.tags || {};
            const iconDetails = getNodeIconDetails(tags);
            return {
                node,
                name: nodeName(tags),
                elevation: nodeElevation(tags),
                color: iconDetails.color,
                emoji: iconDetails.emoji
            };
        })
        .sort((a, b) =>
            (b.elevation ?? -Infinity) - (a.elevation ?? -Infinity) ||
            (a.name ?? '').localeCompare(b.name ?? '')
        );

    const renderNodes = () => {
        nodesLayer.clearLayers();
        const filteredNodes: any[] = [];
        const minPixelDistance = 24;

        const selectedNode = uniqueNodes.find(node => node.ref === selectedPeakId);
        if (selectedNode) filteredNodes.push(selectedNode);

        uniqueNodes.forEach(node => {
            const p1 = map.project([node.lat, node.lon], map.getZoom());
            const isOverlapping = filteredNodes.some(n => {
                const p2 = map.project([n.lat, n.lon], map.getZoom());
                return p1.distanceTo(p2) < minPixelDistance;
            });

            if (!isOverlapping) {
                filteredNodes.push(node);
            }
        });

        filteredNodes.forEach(node => {
            const iconDetails = getNodeIconDetails(node.tags || {});

            const icon = L.divIcon({
                html: `<div style="background-color: ${iconDetails.color}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); font-size: 13px; line-height: 1;">${iconDetails.emoji}</div>`,
                className: '',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -12]
            });

            const marker = L.marker([node.lat, node.lon], { icon })
            .bindPopup(nodePopupHtml(node.tags));
            nodesLayer.addLayer(marker);
        });
    };

    rerenderNodes = renderNodes;
    renderNodes();
    map.on('zoomend', renderNodes);

    (map as any).almostOver.addLayer(hikesLayer);
    map.on('almost:click', function (e: any) {
        // noinspection JSDeprecatedSymbols
        const layer = e.layer as Layer;
        layer.openPopup(e.latlng);
    });

    const info = new L.Control({position: 'topright'});

    info.onAdd = function () {
        const divElement = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');

        const anchorElement = L.DomUtil.create('a', 'text-[22px]', divElement);
        anchorElement.href = '#';
        anchorElement.title = t('en', 'web.toggleColors');
        anchorElement.role = 'button';
        anchorElement.ariaLabel = anchorElement.title;
        anchorElement.ariaDisabled = 'false';
        anchorElement.onclick = () => {
            hikesLayer.setStyle(isStatic.toggle() ? staticColor : randomColor);
            return false;
        }

        const iconElement = L.DomUtil.create('span', '', anchorElement);
        iconElement.ariaHidden = 'true';
        iconElement.innerHTML = '🎨';

        return divElement;
    };

    info.addTo(map);

    // Optional region outlines, off until switched on; each kind is fetched the first time.
    const regionPane = addRegionPane(map);
    const regionGroups: Record<RegionKind, any> = { range: L.layerGroup(), area: L.layerGroup() };
    const regionsLoaded = new Set<RegionKind>();
    L.control.layers(undefined, {
        [tHtml('en', 'web.ranges')]: regionGroups.range,
        [tHtml('en', 'web.areas')]: regionGroups.area,
    }, { position: 'topright' }).addTo(map);
    map.on('overlayadd', async (e: any) => {
        const kind = (Object.keys(regionGroups) as RegionKind[]).find((k) => regionGroups[k] === e.layer);
        if (!kind || regionsLoaded.has(kind)) return;
        regionsLoaded.add(kind);
        try {
            regionGroups[kind].addLayer(await regionLayer(L, { kind, pane: regionPane }));
        } catch (ex) {
            regionsLoaded.delete(kind);
            console.warn('Region outlines failed to load', ex);
        }
    });

    isLoading = false;
}

onMount(() => {
	startLoading();
});
</script>


<Heading tag="h2" class="mb-2">{t('en', 'tags.Web.heading')}</Heading>
<p class="mb-8 text-gray-600 dark:text-gray-300">{intro[0]}</p>

<div class="flex flex-col gap-4 mt-8">
    <article class="
        w-full max-w-none p-4 md:p-6 bg-gray-50 rounded-lg dark:bg-gray-800 flex flex-col gap-6
        prose dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-500
    ">
        <div class="flex flex-row flex-wrap gap-x-4 gap-y-4 md:gap-x-6 md:gap-y-6 not-prose w-full">
            <div class="flex items-center gap-3 basis-[140px] grow">
                <div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
                    <TrackingOutline class="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div class="min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{t('en', 'web.stats.hikes')}</div>
                    <div class="font-semibold whitespace-nowrap">{webData.stats.totalHikes}</div>
                </div>
            </div>
            <div class="flex items-center gap-3 basis-[140px] grow">
                <div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
                    <ClockOutline class="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div class="min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{t('en', 'web.stats.time')}</div>
                    <div class="font-semibold whitespace-nowrap">{getTime(webData.stats.totalTime)}</div>
                </div>
            </div>
            <div class="flex items-center gap-3 basis-[140px] grow">
                <div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
                    <MapPinOutline class="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div class="min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{t('en', 'web.stats.distance')}</div>
                    <div class="font-semibold whitespace-nowrap">{getDistance(webData.stats.totalDistance)}</div>
                </div>
            </div>
            <div class="flex items-center gap-3 basis-[140px] grow">
                <div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
                    <ArrowUpOutline class="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div class="min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{t('en', 'web.stats.ascent')}</div>
                    <div class="font-semibold whitespace-nowrap">{getDistance(webData.stats.totalAscent)}</div>
                </div>
            </div>
            <div class="flex items-center gap-3 basis-[140px] grow">
                <div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
                    <ArrowDownOutline class="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div class="min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{t('en', 'web.stats.descent')}</div>
                    <div class="font-semibold whitespace-nowrap">{getDistance(webData.stats.totalDescent)}</div>
                </div>
            </div>
        </div>
        <div class="w-full min-w-0">
            <HikesTimeline weeks={webData.weeks} />
        </div>
    </article>
    <div class="flex flex-col lg:flex-row gap-4">
        <aside class="w-full lg:w-72 xl:w-80 shrink-0 order-last lg:order-none relative bg-gray-50 rounded-lg dark:bg-gray-800">
            <div class="lg:absolute lg:inset-0 flex flex-col p-4 transition-opacity duration-500 {isLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'}">
                <div class="shrink-0 mb-3 text-xl font-semibold text-gray-900 dark:text-white">
                    {t('en', 'web.peaks', { count: peaks.length })}
                </div>
                <ul class="overflow-y-auto max-h-72 lg:max-h-none lg:flex-1 lg:min-h-0 -mx-1 px-1">
                    {#each peaks as peak (peak.node.ref)}
                        <li>
                            <button
                                type="button"
                                onclick={() => focusPeak(peak)}
                                class="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md
                                    hover:bg-gray-100 dark:hover:bg-gray-700
                                    {selectedPeakId === peak.node.ref ? 'bg-gray-100 dark:bg-gray-700' : ''}"
                            >
                                <span
                                    class="shrink-0 w-4 h-4 rounded-full border border-white shadow-sm flex items-center justify-center text-[9px] leading-none"
                                    style="background-color: {peak.color};"
                                    aria-hidden="true"
                                >{peak.emoji}</span>
                                <span class="min-w-0 truncate text-sm text-gray-900 dark:text-white">
                                    {peak.name ?? t('en', 'web.unnamedPeak')}
                                </span>
                                {#if peak.elevation !== null}
                                    <span class="ml-auto shrink-0 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        {formatElevation(peak.elevation)}
                                    </span>
                                {/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            </div>
        </aside>
        <div class="w-full min-w-0 lg:flex-1 bg-gray-50 rounded-lg overflow-hidden dark:bg-gray-800 relative z-0 aspect-[4/3] lg:aspect-[21/9]">
            <div class="w-full h-full transition-opacity duration-500 {isLoading ? 'opacity-0' : 'opacity-100'}">
                <div id="map" class="w-full h-full relative z-0"></div>
            </div>
        </div>
    </div>
</div>
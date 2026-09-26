import { providerFolder, providers } from '$lib/data/map-providers';
import { primaryGeometryColor, secondaryIndicatorColor } from '$lib/hikes/build-geometry';
import { getNodeIconDetails, formatTags } from '$lib/hikes/map-utils';

export interface Map2dHandle {
    setIndicator: (lat: number, lon: number) => void;
    hideIndicator?: () => void;
    destroy?: () => void;
}

/** A located post photo pinned on the map, drawn from its blur placeholder. */
export interface Map2dPhoto {
    lat: number;
    lon: number;
    /** Tiny data-URI image (the post's LQIP) used as the marker face. */
    blur: string;
    alt: string;
    /** Index into the post's `media` list, i.e. the image's `data-media-index`. */
    mediaIndex: number;
}

const PHOTO_MARKER_SIZE = 30;

/**
 * Keep the items that don't sit within `minPixelDistance` of an earlier kept
 * one at the map's current zoom — earlier items win, so callers control
 * priority by order.
 */
function declutter<T extends { lat: number; lon: number }>(map: any, items: T[], minPixelDistance: number): T[] {
    const zoom = map.getZoom();
    const kept: { item: T; point: any }[] = [];
    for (const item of items) {
        const point = map.project([item.lat, item.lon], zoom);
        if (!kept.some((k) => point.distanceTo(k.point) < minPixelDistance)) kept.push({ item, point });
    }
    return kept.map((k) => k.item);
}

function getRouteCenter(geojson: any): [number, number] {
    const coords = geojson?.features?.[0]?.geometry?.coordinates;
    if (!coords?.length) return [0, 0];
    const mid = coords[Math.floor(coords.length / 2)];
    return [mid[1], mid[0]];
}

export async function initMap2d(
    container: HTMLElement,
    geojson: any,
    nodes?: any[] | null,
    photos?: Map2dPhoto[],
    onPhotoClick?: (mediaIndex: number) => void
): Promise<Map2dHandle> {
    const noop: Map2dHandle = { setIndicator: () => {} };
    const { L } = await import('$lib/components/leaflet.almostover.js');

    const routeFeature = geojson?.features?.[0];
    if (!routeFeature) return noop;

    const [lat, lon] = getRouteCenter(geojson);

    const mapOsm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    const mapOsmLocal = L.tileLayer(
        `/${providerFolder}/maps/${providers.osm.tileset}/{z}_{x}_{y}.${providers.osm.format}`,
        {
            maxZoom: 13, minZoom: 13,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
    );
    const mapMapyczLocal = L.tileLayer(
        `/${providerFolder}/maps/${providers.mapyOutdoor.tileset}/{z}_{x}_{y}.${providers.mapyOutdoor.format}`,
        {
            maxZoom: 13, minZoom: 13,
            attribution: '&copy; <a href="https://o.seznam.cz" target="_blank" rel="noopener">Seznam.cz, a.s.</a> and <a href="https://licence.mapy.cz/?doc=mapy_attr&lang=en" target="_blank" rel="noopener">more</a>'
        }
    );
    const mapSatelliteLocal = L.tileLayer(
        `/${providerFolder}/maps/${providers.mapboxSatellite.tileset}/{z}_{x}_{y}.${providers.mapboxSatellite.format}`,
        {
            maxZoom: 13, minZoom: 13,
            attribution: '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="https://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>'
        }
    );

	const map = L.map(container, {
				// @ts-ignore
        almostOnMouseMove: false,
        almostDistance: 15,
        layers: [mapOsm],
    }).setView([lat, lon], 12);

    // Created up front so the layer control can list it as a toggleable overlay;
    // filled once the route has set the initial zoom (see renderPhotos below).
    const photosLayer = photos?.length ? L.layerGroup().addTo(map) : undefined;

    const layerControl = L.control.layers({
        'OSM Mirror': mapOsmLocal,
        'Mapy.cz Outdoor': mapMapyczLocal,
        'Mapbox Satellite': mapSatelliteLocal,
        'OpenStreetMap': mapOsm,
    }, photosLayer ? { 'Photos': photosLayer } : undefined).addTo(map);

    const controlsContainer = layerControl.getContainer();
    if (controlsContainer) {
        const refocus = () => {
            const inputs = controlsContainer.getElementsByTagName('input');
            for (let i = 0; i < inputs.length; ++i) inputs[i].disabled = false;
            map.setZoom(13);
        };
        controlsContainer.addEventListener('mouseover', refocus);
        controlsContainer.addEventListener('click', refocus);
        const inputs = controlsContainer.getElementsByTagName('input');
        for (let i = 0; i < inputs.length; ++i) {
            inputs[i].addEventListener('mouseover', refocus);
            inputs[i].addEventListener('click', refocus);
            inputs[i].addEventListener('change', refocus);
        }
    }

    L.geoJSON(routeFeature, {
        style: () => ({ color: '#ffffff', weight: 7, opacity: 0.9 }),
        interactive: false
    }).addTo(map);

    const hikesLayer = L.geoJSON(routeFeature, {
        style: () => ({ color: primaryGeometryColor, weight: 4, opacity: 1.0 })
    }).addTo(map);
    // @ts-ignore
		map.almostOver.addLayer(hikesLayer);

    map.fitBounds(hikesLayer.getBounds(), { padding: [16, 16] });

    if (photosLayer && photos) {
        const renderPhotos = () => {
            photosLayer.clearLayers();
            for (const photo of declutter(map, photos, PHOTO_MARKER_SIZE)) {
                const icon = L.divIcon({
                    html: `<div style="box-sizing:border-box;width:100%;height:100%;border:2px solid white;border-radius:6px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.4);cursor:pointer;"><img src="${photo.blur.replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;margin:0;" /></div>`,
                    className: '',
                    iconSize: [PHOTO_MARKER_SIZE, PHOTO_MARKER_SIZE],
                    iconAnchor: [PHOTO_MARKER_SIZE / 2, PHOTO_MARKER_SIZE / 2]
                });
                // `title` doubles as the hover tooltip and the focused marker's accessible name.
                L.marker([photo.lat, photo.lon], { icon, title: photo.alt, alt: photo.alt, riseOnHover: true })
                    .on('click', () => onPhotoClick?.(photo.mediaIndex))
                    .addTo(photosLayer);
            }
        };
        renderPhotos();
        map.on('zoomend', renderPhotos);
    }

    if (nodes?.length) {
        const nodesLayer = L.layerGroup().addTo(map);

        const renderNodes = () => {
            nodesLayer.clearLayers();
            for (const node of declutter(map, nodes, 24)) {
                const name = node.tags?.name || node.tags?.natural || 'POI';
                const ele = node.tags?.ele ? ` (${node.tags.ele}m)` : '';
                const { emoji, color } = getNodeIconDetails(node.tags ?? {});
                const icon = L.divIcon({
                    html: `<div style="background-color:${color};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);font-size:13px;line-height:1;">${emoji}</div>`,
                    className: '',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                    popupAnchor: [0, -12]
                });

                const tagsList = formatTags(node.tags ?? {})
                    .map(([k, v]: [string, string]) => `<tr><td style="padding-right:8px;font-weight:600;font-size:11px;color:#6b7280;vertical-align:top;white-space:nowrap;">${k}</td><td style="font-size:11px;word-break:break-word;">${v}</td></tr>`)
                    .join('');
                const popupContent = `<div style="margin-bottom:8px;"><b>${name}</b>${ele}</div>`
                    + (tagsList ? `<div style="max-height:150px;overflow-y:auto;"><table style="min-width:100%;border-spacing:0;">${tagsList}</table></div>` : '');

                L.marker([node.lat, node.lon], { icon }).bindPopup(popupContent).addTo(nodesLayer);
            }
        };

        renderNodes();
        map.on('zoomend', renderNodes);
    }

    // Elevation-chart hover indicator
    const indicator = new L.CircleMarker([lat, lon], {
        radius: 6,
        fillColor: secondaryIndicatorColor,
        color: secondaryIndicatorColor,
        fillOpacity: 1,
        weight: 2,
    }).addTo(map);
    indicator.getElement()?.classList.add('hidden');

    return {
        setIndicator: (ilat: number, ilon: number) => {
            indicator.setLatLng([ilat, ilon]);
            indicator.getElement()?.classList.remove('hidden');
        },
        hideIndicator: () => {
            indicator.getElement()?.classList.add('hidden');
        },
        // Leaflet registers its own window/document listeners internally;
        // map.remove() is what tears those down.
        destroy: () => {
            map.remove();
        },
    };
}

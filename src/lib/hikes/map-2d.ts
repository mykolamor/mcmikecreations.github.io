import { providerFolder, providers } from '$lib/data/map-providers';
import { primaryGeometryColor, secondaryIndicatorColor } from '$lib/hikes/build-geometry';
import {
    declutterBy, nodeIconHtml, nodePopupHtml, photoIconHtml,
    getMapPhotosPref, onMapPhotosPref, setMapPhotosPref,
    NODE_MARKER_SIZE, PHOTO_MARKER_SIZE, type MapPhoto
} from '$lib/hikes/map-utils';

export interface Map2dHandle {
    setIndicator: (lat: number, lon: number) => void;
    hideIndicator?: () => void;
    destroy?: () => void;
}

/** Declutter `items` at the map's current zoom (see `declutterBy`). */
function declutter<T extends { lat: number; lon: number }>(map: any, items: T[], minPixelDistance: number): T[] {
    const zoom = map.getZoom();
    return declutterBy(items, (item) => map.project([item.lat, item.lon], zoom), minPixelDistance);
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
    photos?: MapPhoto[],
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
    const photosLayer = photos?.length ? L.layerGroup() : undefined;
    let unsubscribePhotos: (() => void) | undefined;
    if (photosLayer) {
        // Shown per the remembered preference, shared with the 3D map's toggle.
        if (getMapPhotosPref()) photosLayer.addTo(map);
        map.on('overlayadd', (e: any) => { if (e.layer === photosLayer) setMapPhotosPref(true); });
        map.on('overlayremove', (e: any) => { if (e.layer === photosLayer) setMapPhotosPref(false); });
        unsubscribePhotos = onMapPhotosPref((on) => {
            if (on && !map.hasLayer(photosLayer)) photosLayer.addTo(map);
            else if (!on && map.hasLayer(photosLayer)) map.removeLayer(photosLayer);
        });
    }

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
                    html: photoIconHtml(photo),
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
            for (const node of declutter(map, nodes, NODE_MARKER_SIZE)) {
                const half = NODE_MARKER_SIZE / 2;
                const icon = L.divIcon({
                    html: nodeIconHtml(node.tags),
                    className: '',
                    iconSize: [NODE_MARKER_SIZE, NODE_MARKER_SIZE],
                    iconAnchor: [half, half],
                    popupAnchor: [0, -half]
                });
                L.marker([node.lat, node.lon], { icon }).bindPopup(nodePopupHtml(node.tags)).addTo(nodesLayer);
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
            unsubscribePhotos?.();
            map.remove();
        },
    };
}

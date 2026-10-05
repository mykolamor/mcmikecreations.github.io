import { providerFolder, providers } from '$lib/data/map-providers';
import { primaryGeometryColor, secondaryIndicatorColor } from '$lib/hikes/build-geometry';
import {
    alternatingOffset, declutterBy, factsPinLift, getNodeIconDetails, nodeIconHtml, nodePopupHtml, photoIconHtml,
    mapFactsPref, mapPhotosPref,
    NODE_MARKER_SIZE, PHOTO_MARKER_SIZE, type LayerPref, type MapPhoto
} from '$lib/hikes/map-utils';
import {
    factsPinIconHtml, factsPinWidth, nodeFactsBadgeHtml, nodeFactsPopupHtml, offsetNearRoute, pinPopupHtml, pinsByNode, pinText,
    FACTS_PIN_H, FACTS_PIN_POINTER,
    type FactsMarks
} from '$lib/hikes/facts-overlay';

/**
 * How far a bailout route is pushed off the main route where they run
 * together, on the ground (m), so zoomed out it stays on the same road
 * instead of drifting onto a neighbouring one. Capped on screen (px) where
 * the dashed line just touches the main line, their white casings
 * overlapping. Further routes alternate sides and step outwards.
 */
const ROUTE_OFFSET_M = 6;
const ROUTE_OFFSET_MAX_PX = 4;
/** Within this of the main route (px) a point gets the full offset, fading out by `ROUTE_OFFSET_FAR_PX`. */
const ROUTE_OFFSET_NEAR_PX = 6;
const ROUTE_OFFSET_FAR_PX = 12;

export interface Map2dHandle {
    setIndicator: (lat: number, lon: number) => void;
    hideIndicator?: () => void;
    /** Center on a photo or POI node and ring it briefly. */
    focusPoint?: (lat: number, lon: number) => void;
    destroy?: () => void;
}

/** Zoom a focused photo is shown at, unless the reader is already closer. */
const FOCUS_ZOOM = 15;
const FOCUS_RING_MS = 4000;

/** Declutter `items` at the map's current zoom (see `declutterBy`). */
function declutter<T extends { lat: number; lon: number }>(map: any, items: T[], minPixelDistance: number): T[] {
    const zoom = map.getZoom();
    return declutterBy(items, (item) => map.project([item.lat, item.lon], zoom), minPixelDistance);
}

/**
 * Shows `layer` per the remembered preference, shared with the 3D map's
 * toggle: the layer control's overlay sets it, and a change made elsewhere on
 * the page adds or removes the layer. Returns the unsubscribe.
 */
function bindLayerPref(map: any, layer: any, pref: LayerPref): () => void {
    if (pref.get()) layer.addTo(map);
    map.on('overlayadd', (e: any) => { if (e.layer === layer) pref.set(true); });
    map.on('overlayremove', (e: any) => { if (e.layer === layer) pref.set(false); });
    return pref.on((on) => {
        if (on && !map.hasLayer(layer)) layer.addTo(map);
        else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    });
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
    onPhotoClick?: (mediaIndex: number) => void,
    facts?: FactsMarks
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
    const unsubscribePhotos = photosLayer && bindLayerPref(map, photosLayer, mapPhotosPref);

    // Hazards, bailout points, water and bailout routes from the post's facts.
    const factsLayer = facts && (facts.pins.length || facts.lines.length || facts.routes.length) ? L.layerGroup() : undefined;
    const unsubscribeFacts = factsLayer && bindLayerPref(map, factsLayer, mapFactsPref);
    // Facts about a POI node go on its marker, not on a pin of their own.
    const { onNodes: nodePins, loose: loosePins } = pinsByNode(factsLayer ? facts!.pins : [], (nodes ?? []).map((n) => n.id));
    let unsubscribeNodeFacts: (() => void) | undefined;

    const overlays: Record<string, any> = {};
    if (photosLayer) overlays['Photos'] = photosLayer;
    if (factsLayer) overlays['Route facts'] = factsLayer;
    const layerControl = L.control.layers({
        'OSM Mirror': mapOsmLocal,
        'Mapy.cz Outdoor': mapMapyczLocal,
        'Mapbox Satellite': mapSatelliteLocal,
        'OpenStreetMap': mapOsm,
    }, Object.keys(overlays).length ? overlays : undefined).addTo(map);

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
            // The node's facts show with the "Route facts" overlay, like the pins.
            const factsOn = !!factsLayer && map.hasLayer(factsLayer);
            for (const node of declutter(map, nodes, NODE_MARKER_SIZE)) {
                const half = NODE_MARKER_SIZE / 2;
                const pin = factsOn ? nodePins.get(node.id) : undefined;
                const icon = L.divIcon({
                    html: nodeIconHtml(node.tags, pin ? nodeFactsBadgeHtml(pin, getNodeIconDetails(node.tags ?? {}).emoji) : ''),
                    className: '',
                    iconSize: [NODE_MARKER_SIZE, NODE_MARKER_SIZE],
                    iconAnchor: [half, half],
                    popupAnchor: [0, -half]
                });
                L.marker([node.lat, node.lon], { icon }).bindPopup(nodePopupHtml(node.tags, pin ? nodeFactsPopupHtml(pin) : '')).addTo(nodesLayer);
            }
        };

        renderNodes();
        map.on('zoomend', renderNodes);
        if (nodePins.size) {
            map.on('overlayadd overlayremove', (e: any) => { if (e.layer === factsLayer) renderNodes(); });
            // A toggle elsewhere on the page adds or removes the layer first (`bindLayerPref`).
            unsubscribeNodeFacts = mapFactsPref.on(() => renderNodes());
        }
    }

    if (factsLayer && facts) {
        // Hazard stretches over the route line, then the pins on top.
        for (const line of facts.lines) {
            L.polyline(line.coords, { color: line.color, weight: 7, opacity: 0.55, lineCap: 'butt' })
                .bindTooltip(line.title, { sticky: true, className: 'facts-tooltip' })
                .addTo(factsLayer);
        }
        // Bailout routes: dashed on a white casing, pushed beside the main
        // route where they share it. The offset is in pixels, so it's redone
        // on every zoom.
        const mainCoords: number[][] = routeFeature.geometry?.coordinates ?? [];
        const routeLines = facts.routes.map((route) => {
            const casing = L.polyline(route.coords, { color: '#ffffff', weight: 5, opacity: 0.85, interactive: false }).addTo(factsLayer);
            const dashed = L.polyline(route.coords, { color: route.color, weight: 3, opacity: 1, dashArray: '7 6' })
                .bindTooltip(route.title, { sticky: true, className: 'facts-tooltip' })
                .addTo(factsLayer);
            return { route, casing, dashed };
        });
        const placeRoutes = () => {
            const zoom = map.getZoom();
            const main = mainCoords.map((c) => map.project([c[1], c[0]], zoom));
            // Web Mercator ground resolution at the map's latitude (256px tiles).
            const metersPerPx = 40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180) / 2 ** (zoom + 8);
            const step = Math.min(ROUTE_OFFSET_M / metersPerPx, ROUTE_OFFSET_MAX_PX);
            routeLines.forEach(({ route, casing, dashed }, i) => {
                const offset = alternatingOffset(i, step);
                const shifted = offsetNearRoute(
                    route.coords.map((c) => map.project(c, zoom)),
                    main,
                    offset,
                    ROUTE_OFFSET_NEAR_PX,
                    ROUTE_OFFSET_FAR_PX
                ).map((p) => map.unproject(L.point(p.x, p.y), zoom));
                casing.setLatLngs(shifted);
                dashed.setLatLngs(shifted);
            });
        };
        if (routeLines.length) {
            placeRoutes();
            map.on('zoomend', placeRoutes);
        }

        for (const pin of loosePins) {
            const width = factsPinWidth(pin);
            // A pin on a POI node stands above the node's own marker instead of covering it.
            const lift = factsPinLift(pin);
            const icon = L.divIcon({
                html: factsPinIconHtml(pin, width),
                className: '',
                iconSize: [width, FACTS_PIN_H + FACTS_PIN_POINTER],
                iconAnchor: [width / 2, FACTS_PIN_H + FACTS_PIN_POINTER + lift],
                popupAnchor: [0, -(FACTS_PIN_H + FACTS_PIN_POINTER + lift)]
            });
            L.marker([pin.lat, pin.lon], { icon, title: pinText(pin), alt: pin.name, riseOnHover: true, zIndexOffset: 500 })
                .bindPopup(pinPopupHtml(pin))
                .addTo(factsLayer);
        }
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

    // Ring for a photo or node focused from the post text. Separate from the
    // marker itself, which may be decluttered away or have its layer switched off.
    const focusRing = new L.CircleMarker([lat, lon], {
        radius: PHOTO_MARKER_SIZE / 2 + 6,
        color: secondaryIndicatorColor,
        weight: 3,
        fill: false,
        interactive: false,
    });
    let focusTimer: ReturnType<typeof setTimeout> | undefined;

    return {
        setIndicator: (ilat: number, ilon: number) => {
            indicator.setLatLng([ilat, ilon]);
            indicator.getElement()?.classList.remove('hidden');
        },
        hideIndicator: () => {
            indicator.getElement()?.classList.add('hidden');
        },
        focusPoint: (plat: number, plon: number) => {
            // The mirrored tile layers only exist at zoom 13, so stay within the active layer's range.
            map.setView([plat, plon], Math.min(Math.max(map.getZoom(), FOCUS_ZOOM), map.getMaxZoom()));
            focusRing.setLatLng([plat, plon]).addTo(map);
            clearTimeout(focusTimer);
            focusTimer = setTimeout(() => focusRing.remove(), FOCUS_RING_MS);
        },
        // Leaflet registers its own window/document listeners internally;
        // map.remove() is what tears those down.
        destroy: () => {
            unsubscribePhotos?.();
            unsubscribeFacts?.();
            unsubscribeNodeFacts?.();
            clearTimeout(focusTimer);
            map.remove();
        },
    };
}

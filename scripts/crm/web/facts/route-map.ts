// The place field's small map: the hike's route on the Map tab's base layer, a tap marks a point. An action, so the map
// lives exactly as long as its element.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import type { MapPayload } from '../../server/map-data';
import { baseLayers } from '../map/layers/base';
import { pickBase } from '../map/layers/base-pick';
import { readPref } from '../map/storage';

export type RouteMapOpts = {
	slug: string;
	date: string | null;
	/** Where the marker starts (the value already written), if anywhere. */
	at: { lat: number; lon: number } | null;
	ontap: (p: { lat: number; lon: number }) => void;
};

export function routeMap(node: HTMLElement, opts: RouteMapOpts) {
	let { ontap } = opts;
	const map = L.map(node, { zoomControl: true });
	let marker: L.CircleMarker | null = null;
	const mark = (lat: number, lon: number) => {
		marker?.remove();
		marker = L.circleMarker([lat, lon], { radius: 8, color: '#c25e00', weight: 3, fillOpacity: 0.4 }).addTo(map);
	};
	map.setView(opts.at ? [opts.at.lat, opts.at.lon] : [47.5, 11.5], opts.at ? 14 : 8);
	if (opts.at) mark(opts.at.lat, opts.at.lon);
	map.on('click', (e: L.LeafletMouseEvent) => {
		mark(e.latlng.lat, e.latlng.lng);
		ontap({ lat: e.latlng.lat, lon: e.latlng.lng });
	});
	let gone = false;

	void (async () => {
		const config = await api<{ tracestrackKey: string | null }>('GET', '/api/map/config').catch(() => ({ tracestrackKey: null }));
		if (gone) return;
		const bases = baseLayers(config.tracestrackKey);
		// The Map tab's remembered base layer; the others one tap away.
		pickBase(bases, readPref('crm.map.base')).layer!.addTo(map);
		L.control.layers(Object.fromEntries(bases.filter((b) => b.layer).map((b) => [b.label, b.layer!]))).addTo(map);
		const params = new URLSearchParams({ slug: opts.slug, ...(opts.date ? { date: opts.date } : {}) });
		const data = await api<MapPayload>('GET', `/api/map?${params}`).catch(() => null);
		const geo = data?.routeUrl ? await fetch(data.routeUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
		if (gone || !geo) return;
		const route = L.geoJSON(geo, { style: { color: '#1565c0', weight: 4, opacity: 0.9 }, interactive: false }).addTo(map);
		if (!opts.at) map.fitBounds(route.getBounds(), { padding: [16, 16] });
	})();

	return {
		update(next: RouteMapOpts) {
			ontap = next.ontap;
		},
		destroy() {
			gone = true;
			map.remove();
		}
	};
}

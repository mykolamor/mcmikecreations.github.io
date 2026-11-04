import L from 'leaflet';

import type { BaseDef } from './base-pick';

/** OSM, Tracestrack Topo (only with a key), Mapy outdoor (through the server proxy). */
export function baseLayers(tracestrackKey: string | null): BaseDef<L.TileLayer>[] {
	const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
	const mapy = L.tileLayer('/api/tiles/mapy/{z}/{x}/{y}', { maxZoom: 19, attribution: '&copy; Mapy.com' });
	const trace = tracestrackKey
		? L.tileLayer(`https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=${encodeURIComponent(tracestrackKey)}`, { maxZoom: 19, attribution: '&copy; Tracestrack, OpenStreetMap contributors' })
		: null;
	return [
		{ id: 'tracestrack', label: 'Tracestrack Topo', layer: trace, ...(trace ? {} : { disabledNote: 'add tracestrackKey to settings' }) },
		{ id: 'osm', label: 'OSM', layer: osm },
		{ id: 'mapy', label: 'Mapy outdoor', layer: mapy }
	];
}

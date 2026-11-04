import L from 'leaflet';
import { squareBounds } from '../../../shared/tile-square';
import { parseGpx } from '../gpx';
import { registerMapLayer, type MapContext } from './registry';
import { addCornerHandle } from './tile-square-edit';

async function track(url: string): Promise<[number, number][]> {
	const res = await fetch(url);
	if (!res.ok) return [];
	return parseGpx(await res.text()).map((p) => [p[0], p[1]]);
}

const dot = (lat: number, lon: number, color: string, opts: L.CircleMarkerOptions = {}) =>
	L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, ...opts });

function checkpointDots(points: [number, number][], color: string, opacity = 1): L.LayerGroup {
	return L.layerGroup(points.map(([lon, lat]) => dot(lat, lon, color, { fillOpacity: opacity, opacity })));
}

registerMapLayer({
	id: 'route',
	label: 'Route GeoJSON',
	defaultOn: true,
	refreshOn: 'version',
	build(ctx: MapContext) {
		if (!ctx.routeGeojson) return null;
		const layer = L.geoJSON(ctx.routeGeojson, { style: { color: '#1565c0', weight: 4, opacity: 0.9 } });
		layer.on('mousemove', (e: L.LeafletMouseEvent) => ctx.hover.route(e.latlng.lat, e.latlng.lng));
		layer.on('mouseout', () => ctx.hover.leave());
		return layer;
	}
});

registerMapLayer({
	id: 'gpx',
	label: 'GPX',
	defaultOn: false,
	refreshOn: 'version',
	async build(ctx) {
		if (!ctx.data.gpxUrl) return null;
		const pts = await track(ctx.data.gpxUrl);
		return pts.length ? L.polyline(pts, { color: '#ef6c00', weight: 3, opacity: 0.9 }) : null;
	}
});

registerMapLayer({
	id: 'bailouts',
	label: 'Bailout',
	defaultOn: false,
	refreshOn: 'version',
	async buildMany(ctx) {
		const out: { id: string; label: string; layer: L.Layer }[] = [];
		for (const b of ctx.data.bailouts) {
			const pts = await track(b.url);
			if (pts.length) out.push({ id: `bailout:${b.route}`, label: `Bailout ${b.route.split('/').pop()}`, layer: L.polyline(pts, { color: '#7b1fa2', weight: 3, dashArray: '6 6' }) });
		}
		return out;
	}
});

/** Below the overlay pane (400), so the line stays under the dots however the two are toggled. */
const LINE_PANE = 'crm-checkpoint-line';

registerMapLayer({
	id: 'checkpoint-line',
	label: 'Checkpoint line',
	defaultOn: true,
	refreshOn: 'version',
	build(ctx) {
		const pts = ctx.data.checkpoints.map(([lon, lat]) => [lat, lon] as [number, number]);
		if (pts.length < 2) return null;
		if (!ctx.map.getPane(LINE_PANE)) ctx.map.createPane(LINE_PANE).style.zIndex = '399';
		return L.polyline(pts, { pane: LINE_PANE, color: '#d32f2f', weight: 2, opacity: 0.8, dashArray: '4 6', interactive: false });
	}
});

registerMapLayer({
	id: 'checkpoints',
	label: 'Checkpoints',
	defaultOn: true,
	refreshOn: 'version',
	build: (ctx) => checkpointDots(ctx.data.checkpoints, '#d32f2f')
});

registerMapLayer({
	id: 'others',
	label: "Other hikes' checkpoints",
	defaultOn: false,
	refreshOn: 'version',
	build: (ctx) => {
		const g = L.layerGroup();
		for (const o of ctx.data.others)
			for (const [lon, lat] of o.checkpoints) dot(lat, lon, '#d32f2f', { fillOpacity: 0.35, opacity: 0.35 }).bindTooltip(o.name).addTo(g);
		return g;
	}
});

registerMapLayer({
	id: 'tile-area',
	label: 'Tile area',
	defaultOn: true,
	refreshOn: 'version',
	build(ctx) {
		const { origin, height } = ctx.data;
		if (!origin || !height) return null;
		const b = squareBounds(origin, height);
		const rect = L.rectangle([[b.south, b.west], [b.north, b.east]], { color: '#2e7d32', weight: 2, dashArray: '8 6', fill: false });
		const g = L.layerGroup([rect]);
		dot(origin.lat, origin.lon, '#2e7d32', { radius: 4 }).addTo(g);
		addCornerHandle(ctx, g, rect, origin, height);
		return g;
	}
});

registerMapLayer({
	id: 'nodes',
	label: 'Hike nodes',
	defaultOn: true,
	refreshOn: 'version',
	build(ctx) {
		const g = L.layerGroup();
		for (const n of ctx.data.nodes) {
			const m = dot(n.lat, n.lon, '#00838f', { radius: 7 }).bindTooltip(n.name ?? n.ref);
			m.on('click', () => ctx.select(n.ref));
			m.addTo(g);
		}
		return g;
	}
});

registerMapLayer({
	id: 'photos',
	label: 'Photo locations',
	defaultOn: false,
	refreshOn: 'version',
	build(ctx) {
		const g = L.layerGroup();
		for (const p of ctx.data.photos) dot(p.lat, p.lon, '#f9a825', { radius: 5 }).bindTooltip(p.caption ?? p.key).addTo(g);
		return g;
	}
});

import L from 'leaflet';
import { heightForCorner, squareBounds, type LatLon } from '../../../shared/tile-square';
import { scopeOf, setField } from '../tools/scope';
import { settle } from '../tools/toast';
import type { MapContext } from './registry';

/** A draggable corner on the tile square: dragging resizes the square live (centred on the origin), release saves the height. */
export function addCornerHandle(ctx: MapContext, group: L.LayerGroup, rect: L.Rectangle, origin: LatLon, height: number): void {
	const corner = (h: number) => {
		const b = squareBounds(origin, h);
		return L.latLng(b.north, b.east);
	};
	const icon = L.divIcon({
		className: 'crm-corner',
		html: '<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><div style="width:16px;height:16px;border-radius:3px;background:#2e7d32;border:2px solid #fff;box-shadow:0 0 3px #000"></div></div>',
		iconSize: [44, 44],
		iconAnchor: [22, 22]
	});
	const marker = L.marker(corner(height), { icon, draggable: true, title: 'Drag to resize the tile area', keyboard: false });
	let current = height;
	const fit = (h: number) => {
		const b = squareBounds(origin, h);
		rect.setBounds([[b.south, b.west], [b.north, b.east]]);
	};
	marker.on('drag', () => {
		const ll = marker.getLatLng(); // Leaflet's LatLng has `lng`, not `lon`
		current = heightForCorner(origin, { lat: ll.lat, lon: ll.lng });
		fit(current);
	});
	marker.on('dragend', () => {
		marker.setLatLng(corner(current));
		if (current === height) return;
		setField(ctx.session, 'map.height', current, scopeOf(ctx.session, 'map.height'));
		void settle(ctx.map, ctx.session as any, `Size set to ${current} px`).then((ok) => {
			if (!ok) {
				current = height;
				fit(height);
				marker.setLatLng(corner(height));
			}
		});
	});
	marker.addTo(group);
}

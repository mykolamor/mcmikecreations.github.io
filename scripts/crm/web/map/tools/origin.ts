import L from 'leaflet';
import { squareBounds } from '../../../shared/tile-square';
import { registerMapTool, type MapContext } from '../layers/registry';
import { scopeOf, setField } from './scope';
import { settle } from './toast';

let off: (() => void) | null = null;

registerMapTool({
	id: 'origin',
	key: 'o',
	label: 'Set origin',
	icon: '\u2316',
	activate(ctx: MapContext) {
		const el = ctx.map.getContainer();
		el.style.cursor = 'crosshair';
		let temp: L.Layer | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const dropTemp = () => {
			clearTimeout(timer);
			temp?.remove();
			temp = null;
		};
		const onClick = async (e: L.LeafletMouseEvent) => {
			const origin = { lat: Math.round(e.latlng.lat * 1e6) / 1e6, lon: Math.round(e.latlng.lng * 1e6) / 1e6 };
			setField(ctx.session, 'map.origin', origin, scopeOf(ctx.session, 'map.origin'));
			// Draw the new square at once; the real layer replaces it after the save, and it goes away if the save fails.
			dropTemp();
			if (ctx.data.height) {
				const b = squareBounds(origin, ctx.data.height);
				temp = L.rectangle([[b.south, b.west], [b.north, b.east]], { color: '#2e7d32', weight: 2, dashArray: '8 6', fill: false, interactive: false }).addTo(ctx.map);
			}
			const ok = await settle(ctx.map, ctx.session as any, `Origin set to ${origin.lat}, ${origin.lon}`);
			if (!ok) dropTemp();
			else timer = setTimeout(dropTemp, 1500);
		};
		ctx.map.on('click', onClick);
		off = () => {
			dropTemp();
			ctx.map.off('click', onClick);
			el.style.cursor = '';
		};
	},
	deactivate() {
		off?.();
		off = null;
	}
});

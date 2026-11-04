import type L from 'leaflet';
import { api } from '../../api';
import { registerMapTool, type MapContext } from '../layers/registry';
import { resolveCheckpoint, type StoreItem } from './checkpoint-snap';
import { currentValue, scopeOf, setField } from './scope';
import { settle } from './toast';

let off: (() => void) | null = null;

/** Store elements near the tap, for snapping; a failed lookup just means no store tier. */
async function storeNear(lat: number, lon: number): Promise<StoreItem[]> {
	const d = 0.001; // ~110 m, comfortably beyond the 30 m snap radius
	try {
		const q = new URLSearchParams({ south: String(lat - d), west: String(lon - d), north: String(lat + d), east: String(lon + d) });
		return (await api<{ items: StoreItem[] }>('GET', `/api/osm/store/bbox?${q}`)).items;
	} catch {
		return [];
	}
}

registerMapTool({
	id: 'checkpoint',
	key: 'c',
	label: 'Add checkpoint',
	icon: '⚑',
	activate(ctx: MapContext) {
		const el = ctx.map.getContainer();
		el.style.cursor = 'crosshair';
		const onClick = async (e: L.LeafletMouseEvent) => {
			const point = { lat: e.latlng.lat, lon: e.latlng.lng };
			const hit = resolveCheckpoint(point, ctx.data, await storeNear(point.lat, point.lon));
			const scope = scopeOf(ctx.session, 'map.checkpoints');
			const cur = currentValue<[number, number][]>(ctx.session, 'map.checkpoints', scope) ?? [];
			setField(ctx.session, 'map.checkpoints', [...cur, [hit.lon, hit.lat]], scope);
			void settle(ctx.map, ctx.session as any, hit.label ? `Checkpoint snapped to ${hit.label}` : 'Checkpoint added');
		};
		ctx.map.on('click', onClick);
		off = () => {
			ctx.map.off('click', onClick);
			el.style.cursor = '';
		};
	},
	deactivate() {
		off?.();
		off = null;
	}
});

import L from 'leaflet';
import { mount, tick, unmount } from 'svelte';
import { api } from '../../api';
import { addRef } from '../osm-store';
import InspectList, { type InspectItem } from '../../components/map/InspectList.svelte';
import { registerMapTool, type MapContext } from '../layers/registry';
import { inspectRadiusM } from './inspect-radius';
import { currentValue, scopeOf, setField } from './scope';
import { settle } from './toast';

let off: (() => void) | null = null;

registerMapTool({
	id: 'inspect',
	key: 'i',
	label: 'Inspect',
	icon: 'ⓘ',
	activate(ctx: MapContext) {
		const { map, session } = ctx;
		map.getContainer().style.cursor = 'help';
		let popup: L.Popup | null = null;
		let app: ReturnType<typeof mount> | null = null;
		let ring: L.CircleMarker | null = null;
		let stopResize: (() => void) | null = null;
		let gen = 0;

		const clear = () => {
			ring?.remove();
			ring = null;
		};
		const closeUi = () => {
			clear();
			stopResize?.();
			stopResize = null;
			if (app) void unmount(app);
			app = null;
			popup?.remove();
			popup = null;
		};
		const highlight = (item: InspectItem | null) => {
			clear();
			if (!item) return;
			const node = item.ref.startsWith('node/');
			ring = L.circleMarker([item.lat, item.lon], { radius: node ? 11 : 18, color: '#e65100', weight: 3, fill: false, dashArray: node ? undefined : '4 4', interactive: false }).addTo(map);
		};

		const onClick = async (e: L.LeafletMouseEvent) => {
			closeUi();
			const mine = ++gen;
			const r = inspectRadiusM(map.getZoom(), e.latlng.lat);
			const box = document.createElement('div');
			const state = $state({ items: [] as InspectItem[], busy: true, error: null as string | null, note: null as string | null });
			const addNode = async (item: InspectItem) => {
				try {
					if (!item.inStore) {
						state.note = 'Adding to the store...';
						state.note = (await addRef(item.ref)) ? 'Store changed, retried' : null;
						item.inStore = true;
					}
					const cur = currentValue<string[]>(session, 'map.nodes', 'hike') ?? [];
					if (!cur.includes(item.ref)) setField(session, 'map.nodes', [...cur, item.ref], 'hike');
					void settle(map, session as any, `Node ${item.name ?? item.ref} added`);
				} catch (err) {
					state.note = null;
					state.error = err instanceof Error ? err.message : String(err);
				}
			};
			const addCheckpoint = (item: InspectItem) => {
				const scope = scopeOf(session, 'map.checkpoints');
				const cur = currentValue<[number, number][]>(session, 'map.checkpoints', scope) ?? [];
				setField(session, 'map.checkpoints', [...cur, [item.lon, item.lat]], scope);
				void settle(map, session as any, 'Checkpoint added');
			};
			app = mount(InspectList, {
				target: box,
				props: {
					get items() {
						return state.items;
					},
					get busy() {
						return state.busy;
					},
					get error() {
						return state.error;
					},
					get note() {
						return state.note;
					},
					onhighlight: highlight,
					onnode: addNode,
					oncheckpoint: addCheckpoint
				}
			});
			// Leaflet sizes a popup when its content is set, so the list renders first; and it never re-measures by itself,
			// so each change (the lookup's message giving way to the list, a note, an error) asks it to, once drawn.
			popup = L.popup({ closeButton: true, autoPan: true, maxWidth: 360 }).setLatLng(e.latlng).setContent(box).openOn(map);
			stopResize = $effect.root(() => {
				$effect(() => {
					void [state.items, state.busy, state.error, state.note];
					void tick().then(() => popup?.update());
				});
			});
			try {
				const q = new URLSearchParams({ lat: String(e.latlng.lat), lon: String(e.latlng.lng), r: String(Math.round(r)) });
				const res = await api<{ items: InspectItem[] }>('GET', `/api/osm/around?${q}`);
				if (mine === gen) state.items = res.items;
			} catch (err) {
				if (mine === gen) state.error = err instanceof Error ? err.message : String(err);
			} finally {
				if (mine === gen) state.busy = false;
			}
		};
		map.on('click', onClick);
		off = () => {
			gen++;
			map.off('click', onClick);
			map.getContainer().style.cursor = '';
			closeUi();
		};
	},
	deactivate() {
		off?.();
		off = null;
	}
});

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { squareBounds } from '../../shared/tile-square';
import { api } from '../api';
import type { MapPayload } from '../../server/map-data';
import { baseLayers } from './layers/base';
import { pickBase } from './layers/base-pick';
import './layers/overlays';
import './tools/inspect.svelte';
import './tools/origin';
import './tools/checkpoint';
import { emitMapSelect, getMapLayers, getMapTools, type DocSession, type MapContext, type MapToolDef } from './layers/registry';
import { makeContext } from './ctx';
import { toast } from './tools/toast';
import { readPref, writePref } from './storage';

const BASE_KEY = 'crm.map.base';
const OVERLAYS_KEY = 'crm.map.overlays';

export type MapView = {
	map: L.Map;
	/** Reloads the payload and rebuilds every overlay (doc version or files changed). */
	refresh(): Promise<MapPayload>;
	data(): MapPayload | null;
	routeGeojson(): any | null;
	/** Called with the pointer position over the route / when it leaves. */
	onRouteHover(fn: (lat: number, lon: number) => void, leave: () => void): void;
	/** Shows (or hides with null) the marker for the elevation chart's hover. */
	setMarker(p: { lat: number; lon: number } | null): void;
	destroy(): void;
};

function readOverlayPrefs(): Record<string, boolean> {
	try {
		const v = JSON.parse(readPref(OVERLAYS_KEY) ?? '{}');
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

export async function createMapView(container: HTMLElement, session: DocSession): Promise<MapView> {
	const config = await api<{ tracestrackKey: string | null }>('GET', '/api/map/config').catch(() => ({ tracestrackKey: null }));
	const map = L.map(container, { zoomControl: true });
	const bases = baseLayers(config.tracestrackKey);
	const base = pickBase(bases, readPref(BASE_KEY));
	base.layer!.addTo(map);

	let data: MapPayload | null = null;
	let routeGeojson: any = null;
	let control: L.Control.Layers | null = null;
	let built: L.Layer[] = [];
	let rebuilding = false;
	let fitted = false;
	let hoverFn: (lat: number, lon: number) => void = () => {};
	let leaveFn: () => void = () => {};
	let marker: L.CircleMarker | null = null;
	let activeTool: MapToolDef | null = null;
	let gen = 0;

	const prefs = readOverlayPrefs();
	let failover = false; // true while the session-only switch to OSM runs: it must not be remembered
	map.on('baselayerchange', (e: L.LayersControlEvent) => {
		const def = bases.find((b) => b.layer === e.layer);
		if (def && !failover) writePref(BASE_KEY, def.id);
	});
	// Mapy goes through the server's cookie handshake; if the very first tiles fail, fall back to OSM for this session.
	const mapy = bases.find((b) => b.id === 'mapy')?.layer;
	const osm = bases.find((b) => b.id === 'osm')?.layer;
	if (mapy && osm) {
		let loaded = false;
		let switched = false;
		mapy.on('tileload', () => (loaded = true));
		mapy.on('tileerror', () => {
			if (loaded || switched || !map.hasLayer(mapy)) return;
			switched = true;
			failover = true;
			map.removeLayer(mapy);
			osm.addTo(map);
			failover = false;
			toast(map, 'Mapy tiles did not load (cookie handshake failed?). Showing OSM for this session.', 8000);
		});
	}
	const idOf = new Map<L.Layer, string>();
	const remember = (e: L.LayersControlEvent, on: boolean) => {
		const id = idOf.get(e.layer);
		if (rebuilding || !id) return;
		prefs[id] = on;
		writePref(OVERLAYS_KEY, JSON.stringify(prefs));
	};
	map.on('overlayadd', (e: L.LayersControlEvent) => remember(e, true));
	map.on('overlayremove', (e: L.LayersControlEvent) => remember(e, false));

	const ctx = (): MapContext =>
		makeContext({ map, session, select: emitMapSelect, hover: { route: (lat, lon) => hoverFn(lat, lon), leave: () => leaveFn() } }, () => data!, () => routeGeojson);

	async function fetchRoute(url: string | null): Promise<any> {
		if (!url) return null;
		try {
			const res = await fetch(url);
			return res.ok ? await res.json() : null;
		} catch {
			return null;
		}
	}

	async function refresh(): Promise<MapPayload> {
		const mine = ++gen;
		const q = new URLSearchParams(session.date ? { slug: session.slug, date: session.date } : { slug: session.slug });
		const next = await api<MapPayload>('GET', `/api/map?${q}`);
		const geo = data && routeGeojson && data.routeUrl === next.routeUrl ? routeGeojson : await fetchRoute(next.routeUrl);
		if (mine !== gen) return next;
		data = next;
		routeGeojson = geo;
		// The view first: layers added to a map without one wait for it in order, and a plain path (the GPX) queues the
		// shared SVG renderer after a group (the route GeoJSON) queued before it, whose paths then draw before the
		// renderer has bounds — Leaflet throws ("reading 'min'"), and the cleanup after it ("reading 'parentNode'").
		if (!fitted) {
			fitted = true;
			const bounds = fitBounds(next, geo);
			if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
			else map.setView([47.7, 11.8], 9);
		}
		rebuilding = true;
		try {
			for (const l of built) map.removeLayer(l);
			idOf.clear();
			for (const l of built) control?.removeLayer(l);
			built = [];
			const overlays: [string, L.Layer, boolean, string][] = [];
			for (const def of getMapLayers()) {
				try {
					if (def.buildMany) for (const x of await def.buildMany(ctx())) overlays.push([x.id, x.layer, prefs[x.id] ?? def.defaultOn, x.label]);
					else if (def.build) {
						const layer = await def.build(ctx());
						if (layer) overlays.push([def.id, layer, prefs[def.id] ?? def.defaultOn, def.label]);
					}
				} catch (e) {
					console.warn(`Map layer ${def.id} failed`, e);
				}
			}
			if (mine !== gen) return next;
			const baseObj: Record<string, L.Layer> = {};
			for (const b of bases) if (b.layer) baseObj[b.label] = b.layer;
			// The control is created once, so a data refresh does not collapse it (phones) or reset its state.
			control ??= L.control.layers(baseObj, {}, { position: 'topright', collapsed: true }).addTo(map);
			for (const [id, layer, on, label] of overlays) {
				idOf.set(layer, id);
				control.addOverlay(layer, label);
				built.push(layer);
				if (on) layer.addTo(map);
			}
			// Listed but unusable bases: disabled rows (the control rebuilds its list on every change, so add them last).
			const baseList = control.getContainer()?.querySelector('.leaflet-control-layers-base');
			baseList?.querySelectorAll('.crm-base-disabled').forEach((n) => n.remove());
			for (const b of bases) if (!b.layer) {
				const row = document.createElement('div');
				row.className = 'crm-base-disabled';
				row.style.cssText = 'color:#888;font-size:0.85em;padding:2px 0';
				row.textContent = `${b.label} (${b.disabledNote})`;
				baseList?.appendChild(row);
			}
		} finally {
			rebuilding = false;
		}
		return next;
	}

	// tools
	const bar = new L.Control({ position: 'topleft' });
	bar.onAdd = () => {
		const div = L.DomUtil.create('div', 'leaflet-bar crm-tools');
		L.DomEvent.disableClickPropagation(div);
		const draw = () => {
			div.replaceChildren();
			for (const t of getMapTools()) {
				const b = L.DomUtil.create('a', '', div) as HTMLAnchorElement;
				b.href = '#';
				b.title = `${t.label} (${t.key.toUpperCase()})`;
				b.textContent = t.icon;
				b.style.cssText = 'width:44px;height:44px;line-height:44px;font-size:20px;text-align:center';
				if (activeTool?.id === t.id) b.style.background = '#cde';
				L.DomEvent.on(b, 'click', (e) => {
					// Stopped here, not left to the bar's disableClickPropagation: Leaflet 1.9 lets a click through and checks
					// its target's ancestors at the map, and draw() below detaches this button first — so the map took it as a
					// map click, and the tool just switched on acted on it (a checkpoint behind the button).
					L.DomEvent.stop(e);
					toggle(t);
					draw();
				});
			}
		};
		draw();
		return div;
	};
	const toggle = (t: MapToolDef | null) => {
		activeTool?.deactivate();
		if (!t || activeTool?.id === t.id) activeTool = null;
		else {
			activeTool = t;
			if (data) t.activate(ctx());
		}
	};
	if (getMapTools().length) bar.addTo(map);
	const onKey = (e: KeyboardEvent) => {
		const el = e.target as HTMLElement | null;
		if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Escape') return toggle(null), undefined;
		const t = getMapTools().find((x) => x.key.toLowerCase() === e.key.toLowerCase());
		if (t) toggle(t);
	};

	try {
		await refresh();
	} catch (e) {
		gen++;
		map.remove();
		throw e;
	}
	document.addEventListener('keydown', onKey);

	return {
		map,
		refresh,
		data: () => data,
		routeGeojson: () => routeGeojson,
		onRouteHover(fn, leave) {
			hoverFn = fn;
			leaveFn = leave;
		},
		setMarker(p) {
			if (!p) {
				marker?.remove();
				marker = null;
				return;
			}
			if (!marker) marker = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(map);
			else marker.setLatLng([p.lat, p.lon]);
		},
		destroy() {
			gen++;
			document.removeEventListener('keydown', onKey);
			activeTool?.deactivate();
			map.remove();
		}
	};
}

function fitBounds(d: MapPayload, geo: any): L.LatLngBounds | null {
	if (geo) {
		const b = L.geoJSON(geo).getBounds();
		if (b.isValid()) return b;
	}
	if (d.origin && d.height) {
		const s = squareBounds(d.origin, d.height);
		return L.latLngBounds([s.south, s.west], [s.north, s.east]);
	}
	const pts = d.checkpoints.map(([lon, lat]) => L.latLng(lat, lon));
	return pts.length ? L.latLngBounds(pts) : null;
}

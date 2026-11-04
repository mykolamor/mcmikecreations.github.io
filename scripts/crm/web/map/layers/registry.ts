import type L from 'leaflet';
import type { MapPayload } from '../../../server/map-data';
import type { createDocSession } from '../../doc-session';

export type DocSession = ReturnType<typeof createDocSession>;

/** What a layer or tool gets: the Leaflet map, the current /api/map payload, the open doc and the selection hook. */
export type MapContext = {
	map: L.Map;
	data: MapPayload;
	session: DocSession;
	/** Selects an item (an OSM ref, or null to clear); the side panel (Task 6) listens through `onMapSelect`. */
	select(ref: string | null): void;
	/** Route hover bridge for the elevation chart. */
	hover: { route(lat: number, lon: number): void; leave(): void };
	/** The route GeoJSON when the route layer loaded it. */
	routeGeojson: any | null;
};

export type MapLayerDef = {
	id: string;
	label: string;
	defaultOn: boolean;
	build?(ctx: MapContext): L.Layer | null | Promise<L.Layer | null>;
	/** For a layer that is several entries in the control (one per bailout). */
	buildMany?(ctx: MapContext): { id: string; label: string; layer: L.Layer }[] | Promise<{ id: string; label: string; layer: L.Layer }[]>;
	/** Rebuilt when the doc version changes (the only supported value; layers always rebuild then). */
	refreshOn?: 'version';
};

export type MapToolDef = {
	id: string;
	key: string;
	label: string;
	icon: string;
	activate(ctx: MapContext): void;
	deactivate(): void;
};

const layers: MapLayerDef[] = [];
const tools: MapToolDef[] = [];
const selectListeners = new Set<(ref: string | null) => void>();

export function registerMapLayer(def: MapLayerDef): void {
	const i = layers.findIndex((l) => l.id === def.id);
	if (i >= 0) layers[i] = def;
	else layers.push(def);
}
export function registerMapTool(def: MapToolDef): void {
	const i = tools.findIndex((t) => t.id === def.id);
	if (i >= 0) tools[i] = def;
	else tools.push(def);
}
export const getMapLayers = (): MapLayerDef[] => [...layers];
export const getMapTools = (): MapToolDef[] => [...tools];

export function onMapSelect(fn: (ref: string | null) => void): () => void {
	selectListeners.add(fn);
	return () => selectListeners.delete(fn);
}
export const emitMapSelect = (ref: string | null): void => selectListeners.forEach((f) => f(ref));

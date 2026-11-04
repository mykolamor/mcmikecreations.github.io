import type { MapPayload } from '../../server/map-data';
import type { MapContext } from './layers/registry';

/** A tool context whose `data` and `routeGeojson` are live: a tool activated before a refresh still sees the new payload. */
export function makeContext(base: Omit<MapContext, 'data' | 'routeGeojson'>, getData: () => MapPayload, getRoute: () => any | null): MapContext {
	return Object.defineProperties({ ...base } as MapContext, {
		data: { get: getData, enumerable: true },
		routeGeojson: { get: getRoute, enumerable: true }
	});
}

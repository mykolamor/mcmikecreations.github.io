const EQUATOR_M = 40075016.686;

export function metresPerPixel(zoom: number, lat: number): number {
	return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

/** The Inspect tap radius: about 12 px on screen, in metres, clamped to what the around query accepts (5-200). */
export function inspectRadiusM(zoom: number, lat: number): number {
	return Math.min(200, Math.max(5, metresPerPixel(zoom, lat) * 12));
}

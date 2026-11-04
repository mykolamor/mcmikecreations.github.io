// The map's tile square: `height` px at zoom 13 (mercator scale 2^21/(2π)), centred on the hike's origin.
// Same maths as insideTileSquare in src/lib/hikes/place-links.ts; one square serves the 2D and 3D maps.

export type LatLon = { lat: number; lon: number };
export type Bounds = { south: number; west: number; north: number; east: number };

const METRES_PER_PX_AT_EQUATOR = 40075016.686 / 2 ** 21;
const METRES_PER_DEGREE = 111194.9266;
const MIN_HEIGHT = 128;
const MAX_HEIGHT = 2048;
const STEP = 16;

const cosOf = (lat: number) => Math.cos((lat * Math.PI) / 180);

/** Half the square's side on the ground, in metres. */
export function squareHalfMetres(lat: number, height: number): number {
	return (height / 2) * METRES_PER_PX_AT_EQUATOR * cosOf(lat);
}

export function squareBounds(origin: LatLon, height: number): Bounds {
	const half = squareHalfMetres(origin.lat, height);
	const dLat = half / METRES_PER_DEGREE;
	const dLon = half / (METRES_PER_DEGREE * cosOf(origin.lat));
	return { south: origin.lat - dLat, west: origin.lon - dLon, north: origin.lat + dLat, east: origin.lon + dLon };
}

export function groundSizeKm(lat: number, height: number): number {
	return (2 * squareHalfMetres(lat, height)) / 1000;
}

/** The square height centred on `origin` that reaches `corner`, rounded to the nearest 16 px (so it may fall up to 8 px short) and clamped to 128-2048. */
export function heightForCorner(origin: LatLon, corner: LatLon): number {
	const north = Math.abs(corner.lat - origin.lat) * METRES_PER_DEGREE;
	const east = Math.abs(corner.lon - origin.lon) * METRES_PER_DEGREE * cosOf(origin.lat);
	const px = (2 * Math.max(north, east)) / (METRES_PER_PX_AT_EQUATOR * cosOf(origin.lat));
	return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px / STEP) * STEP));
}

// Port of the former scripts/matches/terrain.py: the height of the surface the post's 3D map renders at a coordinate.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const ZOOM = 13;
const SEGMENTS = 64;
const BUFFER_PX = 1;
const CACHE_TILES = 64;

/**
 * Python's round(x, 1): the exact binary value rounded to one decimal, exact ties to even. toFixed(1) already
 * rounds the exact value, but sends ties away from zero. A tie needs x*10 to end in exactly .5, which a double
 * only does when x is an odd multiple of 0.25 (x*4 is then an exact odd integer).
 */
export function pyRound1(x: number): number {
	const q = x * 4;
	if (Number.isInteger(q) && Math.abs(q % 2) === 1) {
		const f = Math.floor(x * 10);
		return (f % 2 === 0 ? f : f + 1) / 10 + 0;
	}
	return Number(x.toFixed(1)) + 0;
}

export function tilePosition(lat: number, lon: number, zoom = ZOOM): [number, number] {
	const n = 2 ** zoom;
	const x = ((lon + 180) / 360) * n;
	const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
	return [x, y];
}

export function decodeHeight(r: number, g: number, b: number): number {
	return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/** Decodes an 8-bit, non-interlaced RGB(A) PNG (what the DEM tiles are) into RGB bytes. Synchronous so `height` can be. */
export function decodePng(buf: Buffer): { width: number; height: number; rgb: Uint8Array } {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
	let pos = 8;
	let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
	const idat: Buffer[] = [];
	while (pos + 8 <= buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString('latin1', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			depth = data[8];
			colour = data[9];
			interlace = data[12];
		} else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		pos += 12 + len;
	}
	if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error(`Unsupported DEM PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
	const bpp = colour === 2 ? 3 : 4;
	const stride = width * bpp;
	const raw = inflateSync(Buffer.concat(idat));
	if (raw.length < (stride + 1) * height) throw new Error('Truncated PNG data');
	const out = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const src = y * (stride + 1) + 1;
		const row = y * stride;
		for (let i = 0; i < stride; i++) {
			const x = raw[src + i];
			const a = i >= bpp ? out[row + i - bpp] : 0;
			const b = y > 0 ? out[row - stride + i] : 0;
			const c = i >= bpp && y > 0 ? out[row - stride + i - bpp] : 0;
			let v: number;
			switch (filter) {
				case 0: v = x; break;
				case 1: v = x + a; break;
				case 2: v = x + b; break;
				case 3: v = x + ((a + b) >> 1); break;
				case 4: {
					const p = a + b - c;
					const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
					v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
					break;
				}
				default: throw new Error(`Bad PNG filter ${filter}`);
			}
			out[row + i] = v & 255;
		}
	}
	if (bpp === 3) return { width, height, rgb: out };
	const rgb = new Uint8Array(width * height * 3);
	for (let p = 0; p < width * height; p++) {
		rgb[p * 3] = out[p * 4];
		rgb[p * 3 + 1] = out[p * 4 + 1];
		rgb[p * 3 + 2] = out[p * 4 + 2];
	}
	return { width, height, rgb };
}

class DemTile {
	size: number;
	inner: number;
	private rgb: Uint8Array;

	constructor(file: string) {
		const png = decodePng(readFileSync(file));
		this.size = png.width;
		this.inner = this.size - 2 * BUFFER_PX;
		this.rgb = png.rgb;
	}

	private texel(x: number, y: number): number {
		x = Math.min(Math.max(x, 0), this.size - 1);
		y = Math.min(Math.max(y, 0), this.size - 1);
		const i = (y * this.size + x) * 3;
		return decodeHeight(this.rgb[i], this.rgb[i + 1], this.rgb[i + 2]);
	}

	sample(fx: number, fy: number): number {
		const bx = fx * this.inner - 0.5 + BUFFER_PX;
		const by = fy * this.inner - 0.5 + BUFFER_PX;
		const x0 = Math.floor(bx), y0 = Math.floor(by);
		const tx = bx - x0, ty = by - y0;
		const top = this.texel(x0, y0) * (1 - tx) + this.texel(x0 + 1, y0) * tx;
		const bottom = this.texel(x0, y0 + 1) * (1 - tx) + this.texel(x0 + 1, y0 + 1) * tx;
		return top * (1 - ty) + bottom * ty;
	}

	meshHeight(fx: number, fy: number, segments = SEGMENTS): number {
		const gx = fx * segments, gy = fy * segments;
		const ix = Math.min(Math.floor(gx), segments - 1);
		const iy = Math.min(Math.floor(gy), segments - 1);
		const s = gx - ix, t = gy - iy;
		const vertex = (i: number, j: number) => this.sample(i / segments, j / segments);
		const hb = vertex(ix, iy + 1), hd = vertex(ix + 1, iy);
		if (s + t <= 1) {
			const ha = vertex(ix, iy);
			return ha + s * (hd - ha) + t * (hb - ha);
		}
		const hc = vertex(ix + 1, iy + 1);
		return hc + (1 - s) * (hb - hc) + (1 - t) * (hd - hc);
	}
}

export type Terrain = { height(lat: number, lon: number): number | null };

/** Rendered terrain height (m, rounded to 0.1) from the zoom-13 DEM tiles in `demDir`; null when the tile isn't downloaded. */
export function createTerrain(demDir: string): Terrain {
	const cache = new Map<string, DemTile>();
	const load = (tx: number, ty: number): DemTile | null => {
		const key = `${tx}_${ty}`;
		if (cache.has(key)) {
			const hit = cache.get(key)!;
			cache.delete(key);
			cache.set(key, hit); // most recently used last
			return hit;
		}
		const file = path.join(demDir, `${ZOOM}_${tx}_${ty}.png`);
		const tile = existsSync(file) ? new DemTile(file) : null;
		if (!tile) return null; // not cached: it may be downloaded later
		cache.set(key, tile);
		if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
		return tile;
	};
	return {
		height(lat, lon) {
			const [x, y] = tilePosition(lat, lon);
			const tx = Math.floor(x), ty = Math.floor(y);
			const tile = load(tx, ty);
			if (!tile) return null;
			return pyRound1(tile.meshHeight(x - tx, y - ty));
		}
	};
}

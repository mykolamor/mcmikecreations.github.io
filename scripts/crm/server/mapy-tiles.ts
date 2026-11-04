// Mapy outdoor tiles for the Map tab's base layer: the browser can't send mapy.com's signed cookies, so the server fetches and caches them.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// plain JS module shared with the map-download CLI
import { getMapyCookie, mapyUserAgent } from '../../mapy-cookies.js';
import { ApiError } from './errors';

const BASE = 'https://tilecache.mapy.com/turist-en/';
export const DEFAULT_CAP = 200 * 1024 * 1024;

export type MapyTiles = { get(z: number, x: number, y: number): Promise<Buffer> };

export function createMapyTiles(opts: { dir: string; capBytes?: number; fetch?: typeof fetch; cookie?: () => Promise<string> }): MapyTiles {
	const cap = opts.capBytes ?? DEFAULT_CAP;
	const doFetch = opts.fetch ?? fetch;
	const cookie = opts.cookie ?? (getMapyCookie as () => Promise<string>);

	// Running view of the cache: read from disk once, then kept in step with writes and evictions (no per-miss directory scan).
	let index: Map<string, { size: number; mtimeMs: number }> | null = null;
	let total = 0;
	function loadIndex(): Map<string, { size: number; mtimeMs: number }> {
		if (index) return index;
		index = new Map();
		let names: string[] = [];
		try {
			names = readdirSync(opts.dir).filter((f) => f.endsWith('.png'));
		} catch {
			/* no cache dir yet */
		}
		for (const f of names) {
			const st = statSync(path.join(opts.dir, f));
			index.set(f, { size: st.size, mtimeMs: st.mtimeMs });
			total += st.size;
		}
		return index;
	}

	function record(name: string, size: number): void {
		const idx = loadIndex();
		total += size - (idx.get(name)?.size ?? 0);
		idx.set(name, { size, mtimeMs: Date.now() });
		if (total <= cap) return;
		for (const [f, x] of [...idx].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs)) {
			if (total <= cap) break;
			if (f === name) continue;
			try {
				unlinkSync(path.join(opts.dir, f));
			} catch {
				/* already gone */
			}
			idx.delete(f);
			total -= x.size;
		}
	}

	async function load(z: number, x: number, y: number, file: string): Promise<Buffer> {
		try {
			return readFileSync(file);
		} catch {
			/* miss */
		}
		const res = await doFetch(`${BASE}${z}-${x}-${y}`, {
			headers: {
				'User-Agent': mapyUserAgent,
				Origin: 'https://mapy.com',
				Referer: 'https://mapy.com/',
				Cookie: await cookie(),
				Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'
			}
		});
		if (!res.ok) throw new ApiError(502, `mapy.com tile ${z}/${x}/${y}: ${res.status}`);
		const type = res.headers.get('content-type') ?? '';
		if (!type.startsWith('image/')) throw new ApiError(502, `mapy.com tile ${z}/${x}/${y}: not an image (${type || 'no content-type'})`);
		const buf = Buffer.from(await res.arrayBuffer());
		mkdirSync(opts.dir, { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, buf);
		loadIndex(); // before the write, so the new file is not counted twice
		renameSync(tmp, file);
		record(path.basename(file), buf.length);
		return buf;
	}

	const pending = new Map<string, Promise<Buffer>>();

	return {
		async get(z, x, y) {
			if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 22) throw new ApiError(400, `Bad tile ${z}/${x}/${y}`);
			const file = path.join(opts.dir, `${z}-${x}-${y}.png`);
			let p = pending.get(file);
			if (!p) {
				p = load(z, x, y, file).finally(() => pending.delete(file));
				pending.set(file, p);
			}
			return p;
		}
	};
}

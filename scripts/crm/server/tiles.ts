import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors';
import { assertSafeSlug, repoPaths } from './paths';
import type { Settings } from './settings';
// plain JS modules shared with the CLI
import { loadHikesFrom, postResolverFor } from '../../load-hikes.js';
import { downloadedProviders, hikeSlug, mapFolderUnder, tileFileName, tilesForView, viewsFor } from '../../map-tiles.js';

export type TileStatus = { total: number; missing: number; byProvider: Record<string, number> };
export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

/** Names map-download.js reads from its environment; the Access tokens are required, the SKUs optional. */
export const REQUIRED_TOKENS = ['mapboxDEMAccess', 'mapboxSatelliteAccess', 'nextzenAccess'] as const;
const OPTIONAL_TOKENS = ['mapboxDEMSKU', 'mapboxSatelliteSKU'] as const;

/**
 * Every distinct [x, y, z] tile the hike's rendered views need (the hike page and each post page, as map-download.js
 * fetches them). Read fresh from disk each call.
 */
export function tileViews(root: string, slug: string, _date: string | null): [number, number, number][] {
	assertSafeSlug(slug);
	const p = repoPaths(root);
	const hikes = loadHikesFrom(p.static, p.hikesJson, { fresh: true });
	const selected = hikes.filter((h: any) => hikeSlug(h.route) === slug);
	if (selected.length === 0) throw new ApiError(404, `No hike ${slug}`);
	// A new hike has no origin until one is set (its posts inherit it): without one its square, so its tiles, are unknown.
	if (selected.some((h: any) => !h.standardFeatures?.origin)) throw new ApiError(400, 'No map origin yet: set one on the Map tab (the ⌖ tool)');
	const resolvePost = postResolverFor(p.static);
	const seen = new Set<string>();
	const out: [number, number, number][] = [];
	for (const view of viewsFor(selected, resolvePost)) {
		for (const t of tilesForView(view)) {
			const key = t.join('/');
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(t);
		}
	}
	return out;
}

/** How many of the five providers' tiles are missing from the map folder. `date` is accepted for symmetry; the download covers every view of the hike, so does the status. */
export function tileStatus(root: string, slug: string, date: string | null): TileStatus {
	const tiles = tileViews(root, slug, date);
	const base = mapFolderUnder(root);
	const byProvider: Record<string, number> = {};
	let missing = 0;
	for (const prov of downloadedProviders as { tileset: string; format: string }[]) {
		let n = 0;
		for (const [x, y, z] of tiles) if (!existsSync(path.join(base, tileFileName(prov, x, y, z)))) n++;
		byProvider[prov.tileset] = n;
		missing += n;
	}
	return { total: tiles.length * downloadedProviders.length, missing, byProvider };
}

export function missingTokens(settings: Settings): string[] {
	return REQUIRED_TOKENS.filter((k) => !settings[k]);
}

const running = new Set<string>();

/**
 * Runs `node scripts/map-download.js <slug>` from scripts/ with the tokens in its environment and yields SSE lines:
 * its output lines, then `done` or `error: …`. Throws ApiError(400) naming missing tokens before anything is spawned.
 */
export function downloadTiles(root: string, slug: string, settings: Settings, spawn: SpawnFn = nodeSpawn as SpawnFn): AsyncIterable<string> {
	assertSafeSlug(slug);
	const missing = missingTokens(settings);
	if (missing.length) throw new ApiError(400, `Missing map tokens: ${missing.join(', ')} (set them in the environment or scripts/crm/data/settings.json)`);
	if (running.has(slug)) throw new ApiError(409, `A tile download for ${slug} is already running`);
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of [...REQUIRED_TOKENS, ...OPTIONAL_TOKENS]) env[k] = settings[k] ?? '';
	running.add(slug);
	return stream(root, slug, env, spawn);
}

const sse = (text: string) => `data: ${text}\n\n`;

async function* stream(root: string, slug: string, env: NodeJS.ProcessEnv, spawn: SpawnFn): AsyncGenerator<string> {
	try {
		const queue: string[] = [];
		let wake: (() => void) | null = null;
		let result: string | null = null;
		const push = () => {
			wake?.();
			wake = null;
		};
		let child: ChildProcess;
		try {
			child = spawn(process.execPath, [path.join(root, 'scripts/map-download.js'), slug], { cwd: path.join(root, 'scripts'), env });
		} catch (e) {
			yield sse(`error: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		let open = 0;
		let closed = false;
		let code: number | null = null;
		const lines = (s: NodeJS.ReadableStream | null) => {
			if (!s) return;
			open++;
			let buf = '';
			s.setEncoding?.('utf8');
			s.on('data', (d: string) => {
				buf += d;
				const parts = buf.split(/\r?\n/);
				buf = parts.pop() ?? '';
				for (const l of parts) if (l.trim()) queue.push(sse(l));
				push();
			});
			s.on('end', () => {
				if (buf.trim()) queue.push(sse(buf));
				open--;
				push();
			});
		};
		lines(child.stdout);
		lines(child.stderr);
		child.on('error', (e) => {
			result = `error: ${e.message}`;
			closed = true;
			push();
		});
		child.on('close', (c) => {
			code = c;
			closed = true;
			push();
		});
		for (;;) {
			while (queue.length) yield queue.shift()!;
			if (closed && open === 0) break;
			await new Promise<void>((r) => {
				wake = r;
				if (queue.length || (closed && open === 0)) r();
			});
		}
		yield sse(result ?? (code === 0 ? 'done' : `error: map-download exited with code ${code}`));
	} finally {
		running.delete(slug);
	}
}

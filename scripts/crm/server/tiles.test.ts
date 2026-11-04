import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tileStatus, tileViews, type SpawnFn } from './tiles';
import { defaultRoutes, createApi, type ApiRequest } from './api';
import { makeTempRepo } from './test-repo';
import { tileFileName, downloadedProviders, mapFolderUnder } from '../../map-tiles.js';

const SLUG = 'aiplspitz';
const DATE = '2024-08-31';

function stubSpawn(lines: string[], code: number, seen: { args?: any[]; env?: Record<string, string | undefined>; cwd?: string } = {}): SpawnFn {
	return ((cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => {
		seen.args = [cmd, ...args];
		seen.env = opts.env;
		seen.cwd = opts.cwd;
		const child: any = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		setImmediate(() => {
			for (const l of lines) child.stdout.write(l + '\n');
			child.stdout.end();
			child.stderr.end();
			setImmediate(() => child.emit('close', code));
		});
		return child;
	}) as unknown as SpawnFn;
}

const req = (path: string, query: Record<string, string>): ApiRequest => ({ method: 'POST', path, query: new URLSearchParams(query), headers: {} });

async function drain(stream: AsyncIterable<string>): Promise<string[]> {
	const out: string[] = [];
	for await (const l of stream) out.push(l);
	return out;
}

test('status counts missing tiles from the map folder', () => {
	const root = makeTempRepo();
	const before = tileStatus(root, SLUG, DATE);
	assert.ok(before.total > 0);
	assert.equal(before.missing, before.total);
	// write every osm tile and the first two mapy tiles
	const views = tileViews(root, SLUG, DATE);
	const base = mapFolderUnder(root);
	let osm = 0;
	for (const [x, y, z] of views) {
		mkdirSync(join(base, 'osm-mapnik'), { recursive: true });
		writeFileSync(join(base, tileFileName(downloadedProviders.find((p: any) => p.tileset === 'osm-mapnik')!, x, y, z)), 'x');
		osm++;
	}
	const after = tileStatus(root, SLUG, DATE);
	assert.equal(after.total, before.total);
	assert.equal(after.missing, before.total - osm);
	assert.equal(after.byProvider['osm-mapnik'], 0);
	assert.equal(after.byProvider['mapycz-outdoor'], osm);
	assert.equal(Object.keys(after.byProvider).length, 5);
});

test('download failure is reported as the last event; the tool writes no files itself', async () => {
	const root = makeTempRepo();
	const seen: any = {};
	const api = createApi(root, defaultRoutes({ spawn: stubSpawn(['fetching 1/5', 'Rate Limit Exceeded (429)!'], 1, seen), settings: () => ({ mapboxDEMAccess: 'a', mapboxSatelliteAccess: 'b', nextzenAccess: 'c', mapboxDEMSKU: 's' }) }));
	mkdirSync(mapFolderUnder(root), { recursive: true });
	const before = readdirSync(mapFolderUnder(root), { recursive: true } as any).length;
	const res = await api(req('/api/tiles/download', { slug: SLUG }));
	assert.equal(res.status, 200);
	const lines = await drain(res.stream!);
	assert.deepEqual(lines.slice(0, 2), ['data: fetching 1/5\n\n', 'data: Rate Limit Exceeded (429)!\n\n']);
	assert.match(lines.at(-1)!, /^data: error: .*1/);
	assert.deepEqual(seen.args.slice(1), [join(root, 'scripts/map-download.js'), SLUG]);
	assert.equal(seen.cwd, join(root, 'scripts'));
	assert.equal(seen.env.mapboxDEMAccess, 'a');
	assert.equal(seen.env.mapboxSatelliteAccess, 'b');
	assert.equal(seen.env.nextzenAccess, 'c');
	assert.equal(seen.env.mapboxDEMSKU, 's');
	assert.equal(readdirSync(mapFolderUnder(root), { recursive: true } as any).length, before);
});

test('download success ends with done', async () => {
	const root = makeTempRepo();
	const api = createApi(root, defaultRoutes({ spawn: stubSpawn(['ok'], 0), settings: () => ({ mapboxDEMAccess: 'a', mapboxSatelliteAccess: 'b', nextzenAccess: 'c' }) }));
	const res = await api(req('/api/tiles/download', { slug: SLUG }));
	assert.equal(res.status, 200);
	assert.equal((await drain(res.stream!)).at(-1), 'data: done\n\n');
});

test('missing tokens give 400 listing them, and nothing is spawned', async () => {
	const root = makeTempRepo();
	let spawned = false;
	const spawn = ((..._a: unknown[]) => {
		spawned = true;
		throw new Error('no');
	}) as unknown as SpawnFn;
	const api = createApi(root, defaultRoutes({ spawn, settings: () => ({ nextzenAccess: 'c' }) }));
	const res = await api(req('/api/tiles/download', { slug: SLUG }));
	assert.equal(res.status, 400);
	const msg = (res.json as { error: string }).error;
	assert.match(msg, /mapboxDEMAccess/);
	assert.match(msg, /mapboxSatelliteAccess/);
	assert.doesNotMatch(msg, /nextzenAccess/);
	assert.equal(spawned, false);
});

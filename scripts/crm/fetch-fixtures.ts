/**
 * Re-downloads the smallest recent HEIC from Immich into scripts/crm/data/fixtures/sample.heic
 * (gitignored; used by the HEIC cover test). Run: node_modules/.bin/jiti scripts/crm/fetch-fixtures.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadSettings } from './server/settings';

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'scripts/crm/data/fixtures/sample.heic');

async function main() {
	if (existsSync(out)) {
		console.log(`${out} already exists; nothing to do.`);
		return;
	}
	const { immichUrl, immichKey } = loadSettings(root);
	if (!immichUrl || !immichKey) throw new Error('Immich URL/key not configured (settings.json, env or ~/.config/hike-image-match/config.json)');
	const base = immichUrl.replace(/\/+$/, '');
	const headers = { 'x-api-key': immichKey };
	const takenAfter = new Date(Date.now() - 90 * 86400_000).toISOString();
	const res = await fetch(`${base}/api/search/metadata`, {
		method: 'POST',
		headers: { ...headers, 'content-type': 'application/json' },
		body: JSON.stringify({ takenAfter, type: 'IMAGE', size: 200, withExif: true })
	});
	if (!res.ok) throw new Error(`Immich search failed: HTTP ${res.status}`);
	const items: any[] = (await res.json()).assets?.items ?? [];
	const heics = items
		.filter((a) => /\.heic$/i.test(a.originalFileName ?? a.originalPath ?? ''))
		.sort((a, b) => (a.exifInfo?.fileSizeInByte ?? Infinity) - (b.exifInfo?.fileSizeInByte ?? Infinity));
	if (!heics.length) throw new Error('No recent .heic assets found');
	const orig = await fetch(`${base}/api/assets/${heics[0].id}/original`, { headers });
	if (!orig.ok) throw new Error(`Immich download failed: HTTP ${orig.status}`);
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, Buffer.from(await orig.arrayBuffer()));
	console.log(`Saved ${out}`);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
});

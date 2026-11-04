import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoPaths } from './paths';

const REAL_ROOT = path.resolve(__dirname, '../../..');

/** Copies the hike markdown dir, hikes.json, osm.json, the facts library, the bailout GPX files and the places dir into a temp repo root (same layout). */
export function makeTempRepo(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-repo-'));
	const src = repoPaths(REAL_ROOT);
	const dst = repoPaths(root);
	cpSync(src.markdown, dst.markdown, { recursive: true });
	mkdirSync(path.dirname(dst.hikesJson), { recursive: true });
	cpSync(src.hikesJson, dst.hikesJson);
	if (existsSync(src.osmStore)) cpSync(src.osmStore, dst.osmStore);
	if (existsSync(src.factsLibrary)) cpSync(src.factsLibrary, dst.factsLibrary);
	if (existsSync(src.bailouts)) cpSync(src.bailouts, dst.bailouts, { recursive: true });
	if (existsSync(src.places)) cpSync(src.places, dst.places, { recursive: true });
	return root;
}

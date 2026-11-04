import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Settings = {
	immichUrl?: string;
	immichKey?: string;
	mapboxDEMAccess?: string;
	mapboxDEMSKU?: string;
	mapboxSatelliteAccess?: string;
	mapboxSatelliteSKU?: string;
	nextzenAccess?: string;
	tracestrackKey?: string;
	deeplKey?: string;
	/** The Claude tab's command line, run through an interactive `$SHELL -ic` (aliases and functions work); default `claude`. */
	claudeCommand?: string;
};

const ENV_NAMES: Record<keyof Settings, string> = {
	immichUrl: 'IMMICH_URL',
	immichKey: 'IMMICH_API_KEY',
	mapboxDEMAccess: 'mapboxDEMAccess',
	mapboxDEMSKU: 'mapboxDEMSKU',
	mapboxSatelliteAccess: 'mapboxSatelliteAccess',
	mapboxSatelliteSKU: 'mapboxSatelliteSKU',
	nextzenAccess: 'nextzenAccess',
	tracestrackKey: 'tracestrackKey',
	deeplKey: 'DEEPL_API_KEY',
	claudeCommand: 'CRM_CLAUDE_COMMAND'
};

function readJson(file: string, warn: (msg: string) => void): Record<string, unknown> {
	let text: string;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return {};
	}
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' ? v : {};
	} catch {
		warn(`Ignoring malformed settings file ${file}`);
		return {};
	}
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Precedence: environment > scripts/crm/data/settings.json > the old tool's
 * ~/.config/hike-image-match/config.json (Immich only). Values are never logged.
 */
export function loadSettings(
	root: string,
	env: NodeJS.ProcessEnv = process.env,
	home: string = os.homedir(),
	warn: (msg: string) => void = (m) => console.warn(m)
): Settings {
	const file = readJson(path.join(root, 'scripts/crm/data/settings.json'), warn);
	const old = readJson(path.join(home, '.config/hike-image-match/config.json'), warn);
	const out: Settings = {};
	for (const k of Object.keys(ENV_NAMES) as (keyof Settings)[]) {
		const v = str(env[ENV_NAMES[k]]) ?? str(file[k]);
		if (v) out[k] = v;
	}
	out.immichUrl ??= str(old.immich_url);
	out.immichKey ??= str(old.api_key);
	for (const k of Object.keys(out) as (keyof Settings)[]) if (out[k] === undefined) delete out[k];
	return out;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings } from './settings';

function setup(opts: { settings?: string; old?: string } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-set-'));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-home-'));
	if (opts.settings !== undefined) {
		fs.mkdirSync(path.join(root, 'scripts/crm/data'), { recursive: true });
		fs.writeFileSync(path.join(root, 'scripts/crm/data/settings.json'), opts.settings);
	}
	if (opts.old !== undefined) {
		fs.mkdirSync(path.join(home, '.config/hike-image-match'), { recursive: true });
		fs.writeFileSync(path.join(home, '.config/hike-image-match/config.json'), opts.old);
	}
	return { root, home };
}
const old = JSON.stringify({ api_key: 'oldkey', immich_url: 'http://old' });

test('env wins over settings.json, which wins over the old config file', () => {
	const { root, home } = setup({ settings: JSON.stringify({ immichKey: 'file', immichUrl: 'http://new', nextzenAccess: 'nf' }), old });
	const s = loadSettings(root, { IMMICH_API_KEY: 'env', mapboxDEMAccess: 'm' }, home, () => {});
	assert.deepEqual([s.immichKey, s.immichUrl, s.nextzenAccess, s.mapboxDEMAccess], ['env', 'http://new', 'nf', 'm']);
	assert.equal(loadSettings(root, {}, home, () => {}).immichKey, 'file');
	// The old config file alone is the fallback.
	const fallback = setup({ old });
	assert.deepEqual(loadSettings(fallback.root, {}, fallback.home, () => {}), { immichUrl: 'http://old', immichKey: 'oldkey' });
});

test('empty strings and missing files are ignored', () => {
	const { root, home } = setup();
	assert.deepEqual(loadSettings(root, { IMMICH_URL: '', nextzenAccess: '' }, home, () => {}), {});
	const b = setup({ settings: JSON.stringify({ immichUrl: '' }), old });
	assert.equal(loadSettings(b.root, {}, b.home, () => {}).immichUrl, 'http://old');
});

test('malformed settings.json warns without values and yields none', () => {
	const { root, home } = setup({ settings: '{"immichKey": "SECRET", ' });
	const warnings: string[] = [];
	const s = loadSettings(root, {}, home, (m) => warnings.push(m));
	assert.deepEqual(s, {});
	assert.equal(warnings.length, 1);
	assert.ok(!warnings[0].includes('SECRET'));
});

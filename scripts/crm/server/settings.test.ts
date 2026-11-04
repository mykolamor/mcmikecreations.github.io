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

test('env wins over settings.json', () => {
	const { root, home } = setup({ settings: JSON.stringify({ immichKey: 'file', nextzenAccess: 'nf' }) });
	const s = loadSettings(root, { IMMICH_API_KEY: 'env', mapboxDEMAccess: 'm' }, home, () => {});
	assert.equal(s.immichKey, 'env');
	assert.equal(s.nextzenAccess, 'nf');
	assert.equal(s.mapboxDEMAccess, 'm');
});

test('settings.json wins over the old config file', () => {
	const { root, home } = setup({ settings: JSON.stringify({ immichUrl: 'http://new' }), old });
	const s = loadSettings(root, {}, home, () => {});
	assert.equal(s.immichUrl, 'http://new');
	assert.equal(s.immichKey, 'oldkey');
});

test('old config file is the fallback', () => {
	const { root, home } = setup({ old });
	assert.deepEqual(loadSettings(root, {}, home, () => {}), { immichUrl: 'http://old', immichKey: 'oldkey' });
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

test('the DeepL key comes from DEEPL_API_KEY, then settings.json', () => {
	const { root, home } = setup({ settings: JSON.stringify({ deeplKey: 'file:fx' }) });
	assert.equal(loadSettings(root, {}, home, () => {}).deeplKey, 'file:fx');
	assert.equal(loadSettings(root, { DEEPL_API_KEY: 'env' }, home, () => {}).deeplKey, 'env');
});

test('claudeCommand from settings.json, CRM_CLAUDE_COMMAND wins', () => {
	const { root, home } = setup({ settings: JSON.stringify({ claudeCommand: 'claude-tum' }) });
	assert.equal(loadSettings(root, {}, home, () => {}).claudeCommand, 'claude-tum');
	assert.equal(loadSettings(root, { CRM_CLAUDE_COMMAND: 'claude --model opus' }, home, () => {}).claudeCommand, 'claude --model opus');
});

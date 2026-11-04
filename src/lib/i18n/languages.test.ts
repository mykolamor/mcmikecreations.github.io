// Run with: node_modules/.bin/jiti src/lib/i18n/languages.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, OTHER_LANGS, isLang } from './languages';

test('LANGS starts with en and isLang rejects unknown codes', () => {
	assert.equal(LANGS[0], 'en');
	assert.deepEqual(OTHER_LANGS, LANGS.slice(1));
	for (const lang of LANGS) assert.ok(isLang(lang), lang);
	for (const code of ['fr', 'DE', 'En', '', 'de-AT']) assert.equal(isLang(code), false, code);
});

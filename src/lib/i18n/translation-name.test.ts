// Run with: node_modules/.bin/jiti src/lib/i18n/translation-name.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as names from './translation-name.js';
import { LANGS, OTHER_LANGS } from './languages';

test('the plain-JS name rule shares the one language list', () => {
	assert.equal(LANGS, names.LANGS);
	assert.equal(OTHER_LANGS, names.OTHER_LANGS);
	assert.deepEqual(names.translationName('knorrhuette.de.md'), { source: 'knorrhuette.md', lang: 'de' });
	assert.equal(names.translationName('2026-07-19-x.md'), null);
	assert.throws(() => names.translationName('x.fr.md'), { message: 'Unknown language "fr" in x.fr.md (de)' });
});

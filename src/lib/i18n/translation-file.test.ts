// Run with: node_modules/.bin/jiti src/lib/i18n/translation-file.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translationOf } from './translation-file';

test('a translation file names its source and language', () => {
	assert.deepEqual(translationOf('2026-07-19-x.de.md'), { source: '2026-07-19-x.md', lang: 'de' });
	assert.deepEqual(translationOf('knorrhuette.de.md'), { source: 'knorrhuette.md', lang: 'de' });
	assert.equal(translationOf('x.md'), null);
	assert.equal(translationOf('2026-07-19-x.md'), null);
	assert.equal(translationOf('x.hike.json'), null);
});

test('an unknown language file fails the build naming it', () => {
	assert.throws(() => translationOf('2026-07-19-x.fr.md'), {
		message: 'Unknown language "fr" in 2026-07-19-x.fr.md (de, uk)'
	});
	assert.throws(() => translationOf('2026-07-19-x.DE.md'), {
		message: 'Unknown language "DE" in 2026-07-19-x.DE.md (de, uk)'
	});
	// English is the source itself, never a translation.
	assert.throws(() => translationOf('knorrhuette.en.md'), {
		message: 'Unknown language "en" in knorrhuette.en.md (de, uk)'
	});
});

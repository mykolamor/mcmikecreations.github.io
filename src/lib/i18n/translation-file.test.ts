// Run with: node_modules/.bin/jiti src/lib/i18n/translation-file.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translationOf } from './translation-file';

test('a translation file names its source and language; an unknown language fails the build', () => {
	assert.deepEqual(translationOf('2026-07-19-x.de.md'), { source: '2026-07-19-x.md', lang: 'de' });
	assert.equal(translationOf('2026-07-19-x.md'), null);
	assert.equal(translationOf('x.hike.json'), null);
	assert.throws(() => translationOf('2026-07-19-x.fr.md'), { message: 'Unknown language "fr" in 2026-07-19-x.fr.md (de, uk)' });
	assert.throws(() => translationOf('2026-07-19-x.DE.md'), /Unknown language "DE"/);
	// English is the source itself, never a translation.
	assert.throws(() => translationOf('knorrhuette.en.md'), /Unknown language "en"/);
});

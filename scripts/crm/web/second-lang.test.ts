import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANG_KEY, OLD_LANG_KEY, readSecondLang } from './second-lang';

const store = (o: Record<string, string>) => {
	const m = new Map(Object.entries(o));
	return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('the second language migrates the old facts key', () => {
	assert.equal(LANG_KEY, 'crm.lang');
	assert.equal(OLD_LANG_KEY, 'crm.factsLang');
	// The Facts tab's old choice becomes the CRM's, and stays readable.
	const old = store({ 'crm.factsLang': 'fr' });
	assert.equal(readSecondLang(old, ['de', 'fr']), 'fr');
	assert.deepEqual(Object.fromEntries(old.m), { 'crm.factsLang': 'fr', 'crm.lang': 'fr' });
	// The new key wins over the old one.
	assert.equal(readSecondLang(store({ 'crm.lang': 'de', 'crm.factsLang': 'fr' }), ['de', 'fr']), 'de');
	// A language no longer offered falls back to the old key, then to the first other language; nothing stored then.
	assert.equal(readSecondLang(store({ 'crm.lang': 'it', 'crm.factsLang': 'fr' }), ['de', 'fr']), 'fr');
	const none = store({ 'crm.factsLang': 'en' });
	assert.equal(readSecondLang(none, ['de', 'fr']), 'de');
	assert.equal(none.m.has('crm.lang'), false);
	// English only: no second language.
	assert.equal(readSecondLang(store({ 'crm.lang': 'de' }), []), null);
	// Blocked storage: the default.
	const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
	assert.equal(readSecondLang(blocked, ['de']), 'de');
});

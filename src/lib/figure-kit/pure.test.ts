// Tests for the DOM-free parts of the shared figure kit (static/images/blog/_kit/).
// Run with: node_modules/.bin/jiti src/lib/figure-kit/pure.test.ts (or scripts/crm/run-tests.sh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, num } from '../../../static/images/blog/_kit/text.js';
import { paletteVars, PRES_VARS, tint } from '../../../static/images/blog/_kit/palette.js';
import { fitScale, fitBox } from '../../../static/images/blog/_kit/embed.js';

const loc = { en: 'a', de: 'b', uk: 'c' };

test('pick returns the language, falls back to English, passes strings and calls formatters', () => {
	assert.equal(pick(loc, 'de'), 'b');
	assert.equal(pick(loc, 'fr'), 'a');
	assert.equal(pick('x', 'de'), 'x');
	assert.equal(pick((l: string) => l + '!', 'uk'), 'uk!');
});

test('num formats with the language’s decimal separator', () => {
	assert.equal(num(9.4, 1)('de'), '9,4');
	assert.equal(num(9.4, 1)('en'), '9.4');
});

test('paletteVars gives the default tokens per theme', () => {
	assert.equal(paletteVars(undefined, 'light')['--fig-accent'], 'var(--color-primary-600, #0d9488)');
	assert.equal(paletteVars(undefined, 'dark')['--fig-accent'], 'var(--color-primary-400, #2dd4bf)');
});

test('paletteVars applies a single-value override to both themes and keeps the other defaults', () => {
	const v = paletteVars({ accent: '#f00' }, 'dark');
	assert.equal(v['--fig-accent'], '#f00');
	assert.equal(v['--fig-fg'], 'var(--color-gray-100, #f3f4f6)');
});

test('paletteVars adds post-specific tokens with light/dark values', () => {
	assert.equal(paletteVars({ heavydb: { light: 'red', dark: 'pink' } }, 'dark')['--fig-heavydb'], 'pink');
});

test('PRES_VARS maps the six tokens to the deck frame’s colours', () => {
	assert.equal(Object.keys(PRES_VARS).length, 6);
	assert.equal(PRES_VARS['--fig-dim'], 'var(--pres-dim)');
});

test('tint mixes towards the figure background', () => {
	assert.equal(tint('red', 30), 'color-mix(in oklab, red 30%, var(--fig-bg))');
});

test('fitScale shrinks a figure to the column and never enlarges it', () => {
	assert.equal(fitScale(720, 1440), 0.5);
	assert.equal(fitScale(2000, 1440), 1);
});

test('fitScale is 0 for a container that has no width yet', () => {
	assert.equal(fitScale(0, 1440), 0);
	assert.equal(fitScale(NaN, 1440), 0);
});

test('fitBox centres a figure that is narrower than the column', () => {
	assert.deepEqual(fitBox(825, 625, 610), { scale: 1, left: 100, height: 610 });
});

test('fitBox fills a narrower column edge to edge', () => {
	assert.deepEqual(fitBox(312.5, 625, 610), { scale: 0.5, left: 0, height: 305 });
});

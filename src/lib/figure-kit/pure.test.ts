// Tests for the DOM-free parts of the shared figure kit (static/images/blog/_kit/).
// Run with: node_modules/.bin/jiti src/lib/figure-kit/pure.test.ts (or scripts/crm/run-tests.sh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteVars } from '../../../static/images/blog/_kit/palette.js';
import { fitScale, fitBox } from '../../../static/images/blog/_kit/embed.js';

test('paletteVars: a single value overrides both themes, a light/dark pair adds a post token, the rest stay default', () => {
	const v = paletteVars({ accent: '#f00', heavydb: { light: 'red', dark: 'pink' } }, 'dark');
	assert.equal(v['--fig-accent'], '#f00');
	assert.equal(v['--fig-heavydb'], 'pink');
	assert.equal(v['--fig-fg'], 'var(--color-gray-100, #f3f4f6)');
});

test('a figure shrinks to its column, never enlarges, centres when narrower, and waits for a width', () => {
	assert.equal(fitScale(720, 1440), 0.5);
	assert.equal(fitScale(2000, 1440), 1);
	assert.equal(fitScale(0, 1440), 0);
	assert.equal(fitScale(NaN, 1440), 0);
	assert.deepEqual(fitBox(825, 625, 610), { scale: 1, left: 100, height: 610 });
	assert.deepEqual(fitBox(312.5, 625, 610), { scale: 0.5, left: 0, height: 305 });
});

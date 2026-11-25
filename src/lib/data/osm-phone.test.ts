import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhones, formatPhoneTags } from './osm-phone';

const TEGERNSEE: [number, number] = [47.71, 11.75];
const NEPAL: [number, number] = [28.4, 83.8];

test('numbers format the same however spelled, national ones get the country from the coordinates', () => {
	assert.equal(formatPhones('+4980267496', ...TEGERNSEE), formatPhones('+49 8026 7496', ...TEGERNSEE));
	assert.match(formatPhones('+4980267496', ...TEGERNSEE), /^\+49 \d/);
	const several = formatPhones('9746068008, 9846054685', ...NEPAL).split('; ');
	assert.equal(several.length, 2);
	several.forEach((p) => assert.match(p, /^\+977[ -]?\d/));
	const tags = { name: 'Hut', phone: '+4980267496', website: 'x' };
	const out = formatPhoneTags(tags, ...TEGERNSEE);
	assert.match(out.phone, /^\+49 \d/);
	assert.equal(out.website, 'x');
	assert.equal(tags.phone, '+4980267496', 'the input tags are untouched');
});

test('free text and extensions are kept as written', () => {
	assert.equal(formatPhones('ask at the hut', ...TEGERNSEE), 'ask at the hut');
	assert.equal(formatPhones('  ask at hut, or call 0123 ', ...TEGERNSEE), 'ask at hut, or call 0123');
	const mixed = formatPhones('+4980267496; ask at hut, or call 0123', ...TEGERNSEE).split('; ');
	assert.match(mixed[0], /^\+49 \d/);
	assert.equal(mixed[1], 'ask at hut, or call 0123');
	assert.equal(formatPhones('+49836293988-19; +4980267496', ...TEGERNSEE).split('; ')[0], '+49836293988-19');
});

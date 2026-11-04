import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhones, formatPhoneTags } from './osm-phone';

const TEGERNSEE: [number, number] = [47.71, 11.75];
const NEPAL: [number, number] = [28.4, 83.8];

test('E.164 and spaced spellings format the same', () => {
	assert.equal(formatPhones('+4980267496', ...TEGERNSEE), formatPhones('+49 8026 7496', ...TEGERNSEE));
	assert.match(formatPhones('+4980267496', ...TEGERNSEE), /^\+49 \d/);
});
test('national numbers get the country from the coordinates', () => {
	assert.match(formatPhones('9846359659', ...NEPAL), /^\+977[ -]?\d/);
});
test('several numbers: each formatted, joined with "; "', () => {
	const out = formatPhones('9746068008, 9846054685', ...NEPAL).split('; ');
	assert.equal(out.length, 2);
	out.forEach((p) => assert.match(p, /^\+977/));
});
test('unparseable text is left alone', () => {
	assert.equal(formatPhones('ask at the hut', ...TEGERNSEE), 'ask at the hut');
});
test('formatPhoneTags formats phone keys only and returns new tags', () => {
	const tags = { name: 'Hut', phone: '+4980267496', 'contact:mobile': '9846359659', website: 'x' };
	const out = formatPhoneTags(tags, ...TEGERNSEE);
	assert.equal(out.name, 'Hut');
	assert.equal(out.website, 'x');
	assert.match(out.phone, /^\+49 \d/);
	assert.equal(tags.phone, '+4980267496');
});

test('free text containing a comma is returned unchanged', () => {
	assert.equal(formatPhones('ask at hut, or call 0123', ...TEGERNSEE), 'ask at hut, or call 0123');
	assert.equal(formatPhones('  ask at hut, or call 0123 ', ...TEGERNSEE), 'ask at hut, or call 0123');
});
test('semicolons always separate; a text segment stays as written', () => {
	const out = formatPhones('+4980267496; ask at hut, or call 0123', ...TEGERNSEE).split('; ');
	assert.match(out[0], /^\+49 \d/);
	assert.equal(out[1], 'ask at hut, or call 0123');
});
test('extensions are kept as written', () => {
	assert.equal(formatPhones('+49836293988-19', ...TEGERNSEE), '+49836293988-19');
	assert.equal(formatPhones('+49836293988-19; +4980267496', ...TEGERNSEE).split('; ')[0], '+49836293988-19');
});

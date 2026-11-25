import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandChange, commandsFor, selectedLines } from './commands';

const BODY = 'Hello world\nSecond line\n\nThird [link](/x/) here\n';

test('command edge cases: an empty link, mark missing in a link, line commands over a selection', () => {
	// A link without a selection: the cursor goes between the brackets.
	assert.deepEqual(commandChange('link', { body: BODY, from: 5, to: 5 }), { from: 5, to: 5, insert: '[]()', selFrom: 6, selTo: 6 });
	// Mark missing inside an existing link turns its URL into /404/.
	const inLink = BODY.indexOf('link');
	assert.equal(commandChange('missing', { body: BODY, from: inLink, to: inLink })?.insert, '/404/');
	// Line commands take every line the selection touches, not one it only ends at the start of.
	assert.deepEqual(selectedLines(BODY, 6, 15), [
		{ from: 0, text: 'Hello world' },
		{ from: 12, text: 'Second line' }
	]);
	assert.deepEqual(selectedLines(BODY, 0, 12), [{ from: 0, text: 'Hello world' }]);
	assert.deepEqual(commandChange('heading', { body: BODY, from: 6, to: 15 })?.insert, '## Hello world\n## Second line');
});

test('a translation has no media commands; a place doc no YouTube', () => {
	// Media are added in English first: a translation copies their lines, it adds none.
	const ids = commandsFor('translation').map((c) => c.id);
	assert.deepEqual(ids, COMMANDS.map((c) => c.id).filter((id) => !['photo', 'video', 'youtube'].includes(id)));
	assert.ok(ids.includes('german'));
	assert.deepEqual(commandsFor('place').map((c) => c.id), COMMANDS.filter((c) => c.id !== 'youtube').map((c) => c.id));
});

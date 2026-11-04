import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandChange, commandsFor, selectedLines, shortcutList } from './commands';
import { linePrefix, markMissing, wrap } from '../../shared/md-lines';
import { suggestionKeyNames } from './mentions';

const BODY = 'Hello world\nSecond line\n\nThird [link](/x/) here\n';
const byKey = (key: string) => {
	const c = COMMANDS.find((c) => c.key === key);
	assert.ok(c, `no command bound to ${key}`);
	return c;
};

test('commands map each shortcut to its helper', () => {
	const sel = { body: BODY, from: 6, to: 11 };
	const one = selectedLines(BODY, 6, 11);
	assert.deepEqual(one, [{ from: 0, text: 'Hello world' }]);

	// The shortcuts as the brief names them, the CodeMirror key and the helper each one runs.
	const cases: [string, string, unknown][] = [
		['Ctrl+B', 'Mod-b', wrap(sel, '**', '**')],
		['Ctrl+I', 'Mod-i', wrap(sel, '_', '_')],
		['Ctrl+Alt+2', 'Mod-Alt-2', linePrefix(one, '## ')],
		['Ctrl+K', 'Mod-k', { from: 6, to: 11, insert: '[world]()', selFrom: 14, selTo: 14 }],
		['Ctrl+Alt+G', 'Mod-Alt-g', wrap(sel, '<span lang="de">', '</span>')],
		['Ctrl+Alt+M', 'Mod-Alt-m', markMissing(BODY, sel)]
	];
	for (const [shortcut, key, change] of cases) {
		const c = byKey(key);
		assert.equal(c.shortcut, shortcut);
		assert.deepEqual(commandChange(c.id, sel), change, c.id);
	}
	assert.deepEqual(commandChange('quote', sel), linePrefix(one, '> '));
	assert.deepEqual(commandChange('list', sel), linePrefix(one, '- '));

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

	// Photo, Video, YouTube and Link hike are hooks the tab runs; they make no text change themselves.
	for (const id of ['photo', 'video', 'youtube', 'hikeLink'] as const) {
		assert.equal(COMMANDS.find((c) => c.id === id)?.hook, true);
		assert.equal(commandChange(id, sel), null);
	}
	assert.equal(COMMANDS.find((c) => c.id === 'hikeLink')?.shortcut, '[[');

	// The Ctrl+/ overlay lists every command's shortcut, and itself.
	const listed = shortcutList().map((s) => s.shortcut);
	for (const c of COMMANDS) if (c.shortcut) assert.ok(listed.includes(c.shortcut), c.shortcut);
	assert.ok(listed.includes('Ctrl+/'));
	assert.ok(listed.includes('Ctrl+F'));
	assert.ok(listed.includes('Ctrl+Z'));
	// The place suggestion list's keys, as its hint names them on this platform (Ctrl+N/P only on a Mac).
	for (const mac of [false, true]) {
		const keys = suggestionKeyNames(mac);
		const rows = shortcutList(COMMANDS, mac);
		for (const [label, shortcut] of [
			['Next place suggestion', keys.next],
			['Previous place suggestion', keys.previous],
			['Insert the highlighted place', keys.accept],
			['Close the suggestions', keys.close]
		])
			assert.ok(rows.some((r) => r.label === label && r.shortcut === shortcut), label);
		assert.equal(rows.some((r) => /Ctrl\+[NP]\b|Control\+[NP]/.test(r.shortcut)), mac, `mac ${mac}`);
	}
});

test('a place doc has no YouTube command', () => {
	assert.ok(commandsFor('post').some((c) => c.id === 'youtube'));
	assert.deepEqual(commandsFor('post'), COMMANDS);
	const place = commandsFor('place');
	assert.deepEqual(place.map((c) => c.id), COMMANDS.filter((c) => c.id !== 'youtube').map((c) => c.id));
	// The overlay lists only the doc's commands.
	assert.ok(!shortcutList(place).some((s) => s.label === 'YouTube'));
	assert.deepEqual(shortcutList(place), shortcutList(COMMANDS.filter((c) => c.id !== 'youtube')));
});

test('commandsFor translation has no media commands', () => {
	const ids = commandsFor('translation').map((c) => c.id);
	// Media are added in English first: a translation copies their lines, it adds none.
	for (const media of ['photo', 'video', 'youtube']) assert.ok(!ids.includes(media as never), media);
	// The keys and the German span stay, and Link hike.
	assert.deepEqual(
		ids,
		COMMANDS.map((c) => c.id).filter((id) => !['photo', 'video', 'youtube'].includes(id))
	);
	assert.ok(ids.includes('german'));
});

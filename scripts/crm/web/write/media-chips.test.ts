import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { captionText, chipsAt, dropPos, mediaChips, mediaChipsField, ownFolderFor, photoOrder, posTracker, youtubeIdOf } from './media-chips';
import { mediaInsert, mediaLines } from '../../shared/md-lines';
import type { PostPhoto } from '../photos/types';

const OWN = '/images/projects/data-viz/hikes/stories/demo/';
const BODY = [
	'Intro text with ![inline](x.jpg) media mid-line.',
	'',
	`![A view](${OWN}2026-07-01-01.jpg)`,
	'',
	`  ![Film](${OWN}2026-07-01-02.mp4 "autoplay")  `,
	'',
	'![Clip](https://www.youtube.com/watch?v=B5yRsnelCsw)',
	'',
	'![Not yet](/404/)',
	'',
	'![Topo](/images/hikes/topo/demo.png)',
	''
].join('\n');

test('chips are computed for media lines only and follow edits', () => {
	const chips = mediaChips(BODY, OWN);
	assert.deepEqual(
		chips.map((c) => [c.kind, c.at]),
		[
			['photo', BODY.indexOf('![A view')],
			['video', BODY.indexOf('![Film')],
			['youtube', BODY.indexOf('![Clip')],
			['missing', BODY.indexOf('![Not yet')],
			['photo', BODY.indexOf('![Topo')]
		]
	);
	assert.equal(chips[2].youtube, 'B5yRsnelCsw');
	assert.equal(chips[1].label, '2026-07-01-02.mp4');

	// In the editor: the chips sit where the field says, and move with the text.
	const field = mediaChipsField({ ownFolder: OWN, onPhoto: () => {} });
	let state = EditorState.create({ doc: BODY, extensions: [field] });
	assert.deepEqual(chipsAt(state, field), chips.map((c) => c.at));
	state = state.update({ changes: { from: 0, insert: 'New first line.\n\n' } }).state;
	assert.deepEqual(chipsAt(state, field), chips.map((c) => c.at + 17));
	// Editing a media line into plain text drops its chip; typing the form again brings it back.
	const at = state.doc.toString().indexOf('![A view');
	state = state.update({ changes: { from: at, to: at + 1 } }).state;
	assert.equal(chipsAt(state, field).length, 4);
	state = state.update({ changes: { from: at, insert: '!' } }).state;
	assert.equal(chipsAt(state, field).length, 5);
	// Text typed on the line after the media makes it a paragraph, not a media line.
	const end = state.doc.toString().indexOf('01-01.jpg)') + 10;
	state = state.update({ changes: { from: end, insert: ' and more' } }).state;
	assert.equal(chipsAt(state, field).length, 4);
});

test('photo chip resolves its key for the pin editor', () => {
	const chips = mediaChips(BODY, OWN).filter((c) => c.kind === 'photo');
	// A photo of the doc's own folder is keyed by its file name, any other image by its href.
	assert.deepEqual(
		chips.map((c) => c.key),
		['2026-07-01-01.jpg', '/images/hikes/topo/demo.png']
	);
	assert.equal(ownFolderFor({ kind: 'post', slug: 'demo', date: '2026-07-01' }), OWN);
	assert.equal(ownFolderFor({ kind: 'place', slug: 'knorrhuette' }), '/images/projects/data-viz/hikes/places/knorrhuette/');
	assert.equal(ownFolderFor({ kind: 'hike', slug: 'demo' }), null);

	// The pin editor walks the post's photos in text order (each once), list photos not in the text last.
	const photo = (key: string, href: string): PostPhoto => ({ key, href, assetId: null, inText: true, pins: 0 });
	const list = [photo('2026-07-01-03.jpg', `${OWN}2026-07-01-03.jpg`), photo('/images/hikes/topo/demo.png', '/images/hikes/topo/demo.png'), photo('2026-07-01-01.jpg', `${OWN}2026-07-01-01.jpg`)];
	const twice = BODY + `\n![Again](${OWN}2026-07-01-01.jpg)\n`;
	assert.deepEqual(
		photoOrder(twice, list, OWN).map((p) => p.key),
		['2026-07-01-01.jpg', '/images/hikes/topo/demo.png', '2026-07-01-03.jpg']
	);

	assert.equal(youtubeIdOf('https://youtu.be/B5yRsnelCsw'), 'B5yRsnelCsw');
	assert.equal(youtubeIdOf('https://www.youtube.com/watch?v=B5yRsnelCsw&t=3'), 'B5yRsnelCsw');
	assert.equal(youtubeIdOf('/404/'), null);
});

test('a pending insert position follows the typing made meanwhile', () => {
	let state = EditorState.create({ doc: 'First paragraph.\n\nSecond paragraph.\n' });
	const at = state.doc.toString().indexOf('Second');
	const pos = posTracker(at);
	// Typing before the position moves it; typing after it doesn't.
	const typed = state.update({ changes: { from: 5, insert: ' typed' } });
	pos.map(typed.changes);
	state = typed.state;
	assert.equal(pos.get(), at + 6);
	const later = state.update({ changes: { from: state.doc.length, insert: 'More.' } });
	pos.map(later.changes);
	assert.equal(pos.get(), at + 6);
	// Text typed right at the position stays before the insert (assoc 1).
	const there = later.state.update({ changes: { from: at + 6, insert: 'X' } });
	pos.map(there.changes);
	assert.equal(pos.get(), at + 7);
	assert.equal(there.state.doc.toString().slice(pos.get()), 'Second paragraph.\nMore.');
});

test('a photo dropped on a line goes after that line', () => {
	const state = EditorState.create({ doc: 'One line here.\nAnother line.\n' });
	assert.equal(dropPos(state.doc, 3), 'One line here.'.length);
	assert.equal(dropPos(state.doc, 15), 'One line here.\nAnother line.'.length);
	assert.equal(dropPos(state.doc, state.doc.length), state.doc.length);
});

test('a YouTube title becomes a caption that reads back as the media line', () => {
	for (const title of ['Plain title', 'Hike [4K] up', 'Odd ] bracket', 'Open [ only', 'Back\\slash \\]', '']) {
		const caption = captionText(title);
		const c = mediaInsert('Text.\n', 6, caption, 'https://www.youtube.com/watch?v=B5yRsnelCsw');
		const body = 'Text.\n'.slice(0, c.from) + c.insert + 'Text.\n'.slice(c.to);
		const [line] = mediaLines(body);
		assert.equal(line?.kind, 'youtube', title);
		assert.equal(line.caption, caption);
		assert.equal(body.slice(c.selFrom, c.selTo), caption);
		// Unescaped, the caption is the title again.
		assert.equal(line.caption.replace(/\\(.)/g, '$1'), title);
	}
});

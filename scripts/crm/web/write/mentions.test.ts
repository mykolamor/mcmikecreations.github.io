import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, type SelectionRange, type Transaction } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { buildPlaceIndex } from '$lib/hikes/place-links';
import { buildPlaceDocIndex } from '$lib/hikes/place-docs';
import { mentionInsert } from '../../shared/md-lines';
import { linkedMentions, mentionQuery, mentionSuggestions, proseRuns, suggestionKeys, type SuggestionList } from './mentions';

const ORIGIN = { lat: 47.4, lon: 11.0 };
const node = (ref: string, name: string, lat: number, ele?: number) => ({ ref, lat, lon: 11.0, tags: { name, ...(ele == null ? {} : { ele: String(ele) }) } });
const WALL_NEAR = node('node/1', 'Wallberg', 47.41, 1722);
const WALL_FAR = node('node/2', 'Wallberg', 47.9, 1500);
const WALLBERGHAUS = node('node/3', 'Wallberghaus', 47.42, 1507);
const WALLGAU = node('node/4', 'Wallgau', 47.5);
const KNORR = node('node/5', 'Knorrhütte', 47.401, 2052);
const NODES = [WALL_FAR, WALLGAU, WALLBERGHAUS, WALL_NEAR, KNORR];
const DOCS = [{ slug: 'marienstein', title: 'Marienstein', names: ['Marienstein', 'Holzwiesenthal'] }];

test('suggestions need three letters and rank by distance from origin', () => {
	assert.deepEqual(mentionSuggestions('Wa', NODES, DOCS, ORIGIN), []);
	assert.deepEqual(mentionSuggestions('', NODES, DOCS, ORIGIN), []);
	const got = mentionSuggestions('wal', NODES, DOCS, ORIGIN);
	// Normalized prefix (any case), nearest first; the text is what mentionInsert puts in.
	assert.deepEqual(got.map((s) => s.text), ['Wallberg (1722 m)', 'Wallberghaus (1507 m)', 'Wallgau', 'Wallberg (1500 m)']);
	assert.equal(got[0].node, WALL_NEAR);
	assert.equal(mentionInsert(0, 3, got[0].node!).insert, got[0].text);
	// Accents and ß fold: "knorrhu" finds Knorrhütte.
	assert.deepEqual(mentionSuggestions('Knorrhu', NODES, DOCS, ORIGIN).map((s) => s.text), ['Knorrhütte (2052 m)']);
	// A place doc's names (title or alias) suggest the name as written, before the nodes.
	assert.deepEqual(mentionSuggestions('holz', NODES, DOCS, ORIGIN).map((s) => [s.text, s.node]), [['Holzwiesenthal', null]]);
	// The word before the cursor, only at a word's end.
	assert.deepEqual(mentionQuery('Up the Wal', 10), { from: 7, word: 'Wal' });
	assert.equal(mentionQuery('Up the Wallberg', 10), null);
	assert.equal(mentionQuery('Up the ', 7), null);
});

/** A suggestion list as the tab keeps it: moving highlights, closing closes, accepting puts the place in. */
function list(isOpen: boolean, active: number) {
	const calls: string[] = [];
	const l: SuggestionList = {
		open: () => isOpen,
		active: () => active,
		move: (d) => {
			calls.push(`move ${d}`);
			// Two options, wrapping around as the tab's list does.
			active = active < 0 ? (d > 0 ? 0 : 1) : (active + d + 2) % 2;
		},
		accept: (target) => {
			calls.push('accept');
			target.dispatch(target.state.update({ changes: { from: 4, to: 7, insert: 'Wallberg (1722 m)' } }));
			return true;
		},
		close: () => {
			calls.push('close');
			isOpen = false;
			active = -1;
		}
	};
	return { l, calls };
}

/**
 * An editor stand-in for commands: its state, and line-wise vertical moves (what `cursorLineDown` asks the view for).
 * The cursor starts after `Wal` on the second line.
 */
function editor() {
	const t = {
		state: EditorState.create({ doc: 'One\nWal\nlast line', selection: { anchor: 7 } }),
		dispatch: (tr: Transaction) => void (t.state = tr.state),
		moveVertically(range: SelectionRange, forward: boolean) {
			const line = t.state.doc.lineAt(range.head);
			const n = line.number + (forward ? 1 : -1);
			if (n < 1 || n > t.state.doc.lines) return range;
			const to = t.state.doc.line(n);
			return EditorSelection.cursor(Math.min(to.from + range.head - line.from, to.to));
		},
		moveToLineBoundary: (range: SelectionRange) => range
	};
	return t;
}

/** Presses `key`: the suggestion keymap first, then (when it declines) the editor's own binding, as CodeMirror does. */
function press(t: ReturnType<typeof editor>, key: string, l: SuggestionList) {
	const binding = suggestionKeys(l, false).find((b) => b.key === key);
	const handled = !!binding?.run!(t as never);
	if (!handled) defaultKeymap.find((b) => b.key === key)?.run?.(t as never);
	return { handled, doc: t.state.doc.toString(), head: t.state.selection.main.head };
}

test('Enter inserts a newline when no suggestion is active', () => {
	// The list closed, or open with nothing highlighted: Enter is the editor's newline, Tab the editor's own.
	for (const [open, active] of [[false, -1], [true, -1], [false, 0]] as const) {
		const { l, calls } = list(open, active);
		assert.deepEqual(press(editor(), 'Enter', l), { handled: false, doc: 'One\nWal\n\nlast line', head: 8 }, `open ${open}, active ${active}`);
		assert.equal(press(editor(), 'Tab', l).handled, false);
		assert.deepEqual(calls, []);
	}
	// Escape passes through while the list is closed, and closes it while open.
	assert.equal(press(editor(), 'Escape', list(false, -1).l).handled, false);
	const open = list(true, -1);
	assert.equal(press(editor(), 'Escape', open.l).handled, true);
	assert.deepEqual(open.calls, ['close']);
});

test('plain arrows close the list and move the cursor', () => {
	// The list is open after a common word ("the", "was"), nothing highlighted: ArrowDown is the editor's.
	for (const [key, head] of [['ArrowDown', 11], ['ArrowUp', 3]] as const) {
		const { l, calls } = list(true, -1);
		const t = editor();
		assert.deepEqual(press(t, key, l), { handled: false, doc: 'One\nWal\nlast line', head }, key);
		assert.deepEqual(calls, ['close']);
		// Enter after it is a newline again, never a place.
		assert.equal(press(t, 'Enter', l).handled, false);
		assert.equal(t.state.doc.toString().includes('Wallberg'), false);
	}
	// Closed: the arrows are untouched.
	const closed = list(false, -1);
	assert.equal(press(editor(), 'ArrowDown', closed.l).handled, false);
	assert.deepEqual(closed.calls, []);
});

test('underlines follow what the site links: prose only, place-doc names too', () => {
	const places = buildPlaceIndex(NODES, { origin: ORIGIN });
	const docs = buildPlaceDocIndex(DOCS);
	const body = [
		'## Up the Wallberg (1722 m)',
		'',
		'From Marienstein to Wallberg (1722 m) and [Wallberg (1722 m)](https://x.example/).',
		'Not yet: [Knorrhütte (2052 m)](/404/), `Wallberg (1722 m)` <span lang="de">Wallberg (1722 m)</span>.',
		'',
		'![Wallberg (1722 m) at dusk](/images/a.jpg)',
		'',
		'```',
		'Wallberg (1722 m)',
		'```',
		'Holzwiesenthal, Knorrhütte (2052 m).'
	].join('\n');
	const got = linkedMentions(body, places, docs).map((m) => [m.from, body.slice(m.from, m.to), (m.node as { ref?: string } | null)?.ref ?? null]);
	const at = (s: string, from = 0) => body.indexOf(s, from);
	const line3 = at('Not yet');
	assert.deepEqual(got, [
		[at('Marienstein'), 'Marienstein', null],
		[at('Wallberg (1722 m) and'), 'Wallberg (1722 m)', 'node/1'],
		[at('Knorrhütte', line3), 'Knorrhütte (2052 m)', 'node/5'],
		[at('Wallberg (1722 m)</span>'), 'Wallberg (1722 m)', 'node/1'],
		[at('Holzwiesenthal'), 'Holzwiesenthal', null],
		[at('Knorrhütte (2052 m).'), 'Knorrhütte (2052 m)', 'node/5']
	]);
	// No index, no place docs: nothing.
	assert.deepEqual(linkedMentions(body, null, null), []);
	// The heading, the link, the image and the code are not prose.
	const runs = proseRuns(body).map((r) => body.slice(r.from, r.to));
	assert.ok(!runs.some((r) => r.includes('## Up') || r.includes('x.example') || r.includes('at dusk')));
});

test('a reference naming a place doc is underlined even without a node, as the site marks it', async () => {
	const { parseMarkdown } = await import('$lib/hikes/hikes-info');
	const places = buildPlaceIndex(NODES, { origin: ORIGIN });
	const docs = buildPlaceDocIndex(DOCS);
	const body = 'Down to Marienstein (807 m), then Knorrhütte (2052 m) and Nowhere (999 m).\n';
	const got = linkedMentions(body, places, docs).map((m) => [body.slice(m.from, m.to), (m.node as { ref?: string } | null)?.ref ?? null]);
	assert.deepEqual(got, [
		['Marienstein (807 m)', null],
		['Knorrhütte (2052 m)', 'node/5']
	]);
	// The site: the doc's marker right after that reference.
	const { html } = await parseMarkdown(body, [], { nodes: NODES, origin: ORIGIN, placeDocs: DOCS });
	assert.match(html, /Marienstein&nbsp;\(807&nbsp;m\)<\/span><a class="mk-place-doc"|Marienstein \(807&nbsp;m\)<\/span><a class="mk-place-doc"/);
});

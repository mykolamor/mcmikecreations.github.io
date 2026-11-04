/**
 * Place mentions in the Write editor: suggestions while typing a name (shown
 * under the cursor, never taking the focus), and underlines on the mentions
 * the site links. The underlines follow the renderer: `Name (1234 m)` matched
 * by `findPlaceMentions`, and plain names of the post's place docs, both only
 * in prose text (not in headings, link texts or URLs, image captions, code or
 * HTML tags; the text of a `/404/` link is prose, as the renderer has it).
 */
import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type KeyBinding } from '@codemirror/view';
import { LEADING_ENGLISH, TOPONYM, findPlaceMentions } from '$lib/hikes/hikes-info';
import { normalizePlaceName, type PlaceIndex, type PlaceNode } from '$lib/hikes/place-links';
import type { PlaceDocIndex, PlaceDocRef } from '$lib/hikes/place-docs';
import { mentionText } from '../../shared/md-lines';

// ---------------------------------------------------------------- suggestions

export interface Suggestion {
	/** What goes into the text: `Name (ele m)` for a node, the name as written for a place doc. */
	text: string;
	/** The node, or null for a place doc's name. */
	node: PlaceNode | null;
}

/** Suggestions start after this many letters. */
export const MIN_LETTERS = 3;
const MAX_SUGGESTIONS = 8;
const NAME_TAGS = ['name', 'name:de', 'name:en', 'alt_name', 'short_name', 'official_name'];

/** The letters right before the cursor, when the cursor ends the word; null otherwise. */
export function mentionQuery(doc: string, head: number): { from: number; word: string } | null {
	if (/^[\p{L}\p{M}]/u.test(doc.slice(head, head + 1))) return null;
	const word = /[\p{L}\p{M}]+$/u.exec(doc.slice(Math.max(0, head - 64), head))?.[0];
	return word ? { from: head - word.length, word } : null;
}

/**
 * What `word` may be the start of: the post's place docs (their title or an alias), then the nodes, nearest to
 * `origin` first. Matched on the normalized name's start (case, accents, `ß` and hyphens folded); at most 8, none
 * before the third letter.
 */
export function mentionSuggestions(word: string, nodes: PlaceNode[], placeDocs: PlaceDocRef[], origin: { lat: number; lon: number } | null): Suggestion[] {
	if ([...word.matchAll(/\p{L}/gu)].length < MIN_LETTERS) return [];
	const q = normalizePlaceName(word);
	const starts = (name: unknown) => typeof name === 'string' && normalizePlaceName(name).startsWith(q);

	const out: Suggestion[] = [];
	for (const doc of placeDocs) {
		const name = doc.names.find(starts);
		if (name) out.push({ text: name, node: null });
	}
	const cosLat = origin ? Math.cos((origin.lat * Math.PI) / 180) : 1;
	const distance = (n: PlaceNode) => (origin ? ((n.lon - origin.lon) * cosLat) ** 2 + (n.lat - origin.lat) ** 2 : 0);
	const hits = nodes
		.filter((n) => typeof n?.lat === 'number' && typeof n?.lon === 'number' && NAME_TAGS.some((k) => starts(n.tags?.[k])))
		.map((node) => ({ node, text: mentionText(node), d: distance(node) }))
		.filter((h) => h.text !== '')
		.sort((a, b) => a.d - b.d || a.text.localeCompare(b.text));
	// One entry per text: two elements named and at the same height would insert the same words.
	const seen = new Set(out.map((s) => s.text));
	for (const { node, text } of hits) if (!seen.has(text) && seen.add(text)) out.push({ text, node });
	return out.slice(0, MAX_SUGGESTIONS);
}

/** The suggestion list as the tab keeps it, for the keys. `active` is -1 while nothing is highlighted. */
export interface SuggestionList {
	open(): boolean;
	active(): number;
	move(delta: 1 | -1): void;
	accept(target: { state: EditorState; dispatch: (tr: Transaction) => void }): boolean;
	close(): void;
}

/** A Mac (or iPad with a keyboard), as CodeMirror tells them apart; false outside a browser. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The list's keys as the hint under it and the Ctrl+/ overlay name them. Ctrl+N/P only on a Mac: Firefox and Chrome
 * elsewhere keep them (new window, print) and never pass them to the page.
 */
export function suggestionKeyNames(mac = IS_MAC): { next: string; previous: string; accept: string; close: string } {
	return mac
		? { next: 'Alt+↓ or Control+N', previous: 'Alt+↑ or Control+P', accept: 'Enter or Tab', close: 'Esc' }
		: { next: 'Alt+↓', previous: 'Alt+↑', accept: 'Enter or Tab', close: 'Esc' };
}

/**
 * The keys of an open list (for a keymap above the editor's own). The list opens on a third of all words ("the",
 * "was"), so no plain key belongs to it: the arrows close it and move the cursor, and only Alt+↑/↓ (on a Mac also
 * Control+N/P) step into and through it. Enter and Tab accept only a highlighted option; otherwise, and with the list
 * closed, every key falls through to the editor: Enter is a newline, Tab the browser's.
 */
export function suggestionKeys(list: SuggestionList, mac = IS_MAC): KeyBinding[] {
	const accept = (view: EditorView) => list.open() && list.active() >= 0 && list.accept(view);
	const move = (d: 1 | -1) => () => list.open() && (list.move(d), true);
	const leave = () => {
		if (list.open()) list.close();
		return false;
	};
	return [
		{ key: 'Alt-ArrowDown', run: move(1) },
		{ key: 'Alt-ArrowUp', run: move(-1) },
		...(mac
			? [
					{ key: 'Ctrl-n', run: move(1) },
					{ key: 'Ctrl-p', run: move(-1) }
				]
			: []),
		{ key: 'ArrowDown', run: leave },
		{ key: 'ArrowUp', run: leave },
		{ key: 'Enter', run: accept },
		{ key: 'Tab', run: accept },
		{ key: 'Escape', run: () => list.open() && (list.close(), true) }
	];
}

/**
 * Where the list goes, in client px: under the cursor line, or above it when it would reach past the bottom of the
 * visible viewport (`visualViewport`: what the on-screen keyboard leaves). Kept inside the width.
 */
export function popupPosition(
	caret: { top: number; bottom: number; left: number },
	viewport: { top: number; height: number; width: number },
	size: { width: number; height: number }
): { top: number; left: number } {
	const GAP = 4;
	const MARGIN = 8;
	const below = caret.bottom + GAP;
	const top = below + size.height > viewport.top + viewport.height ? Math.max(viewport.top, caret.top - GAP - size.height) : below;
	const left = Math.max(MARGIN, Math.min(caret.left, viewport.width - size.width - MARGIN));
	return { top, left };
}

/** Where the side panel's map is centred: the photo or mention at the cursor. */
export type MapFocus = { lat: number; lon: number; label: string };

/** `prev` when `next` is the same place, so a cursor moving within one mention leaves the map (and its pan and zoom) alone. */
export function keepFocus(prev: MapFocus | null, next: MapFocus): MapFocus {
	return prev && prev.lat === next.lat && prev.lon === next.lon && prev.label === next.label ? prev : next;
}

// ---------------------------------------------------------------- what the site links

/**
 * The prose of `body` as the renderer's text runs see it: everything but fenced code, headings, images, links
 * (a `/404/` link's text stays), code spans, HTML tags and bare URLs. Offsets into `body`.
 */
export function proseRuns(body: string): { from: number; to: number }[] {
	const out = new Uint8Array(body.length);
	const cut = (from: number, to: number) => out.fill(1, from, to);

	// Block level, line by line: fences and ATX/setext headings.
	let fence: string | null = null;
	let prev: { from: number; to: number; text: boolean } | null = null;
	for (let from = 0; from <= body.length; ) {
		const nl = body.indexOf('\n', from);
		const to = nl === -1 ? body.length : nl;
		const line = body.slice(from, to);
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence) {
			cut(from, to);
			if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) fence = null;
		} else if (marker) {
			cut(from, to);
			fence = marker;
		} else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) cut(from, to);
		else if (prev?.text && /^ {0,3}(=+|-+)\s*$/.test(line)) cut(prev.from, to);
		prev = { from, to, text: !fence && line.trim() !== '' };
		if (nl === -1) break;
		from = nl + 1;
	}

	// Inline: code spans first (nothing inside them is markup), then the rest.
	for (const m of body.matchAll(/(`+)[^`][\s\S]*?\1|<!--[\s\S]*?-->/g)) cut(m.index!, m.index! + m[0].length);
	for (const m of body.matchAll(/!\[(?:\\.|[^\]\\])*\]\([^)\n]*\)/g)) cut(m.index!, m.index! + m[0].length);
	for (const m of body.matchAll(/\[((?:\\.|[^\]\\\n])*)\]\(([^)\n]*)\)/g)) {
		const start = m.index!;
		// A missing post's link renders as its text, places linked; any other link is not prose.
		if (/^\s*\/404\/?\s*$/.test(m[2])) {
			cut(start, start + 1);
			cut(start + 1 + m[1].length, start + m[0].length);
		} else cut(start, start + m[0].length);
	}
	for (const m of body.matchAll(/<\/?[A-Za-z][^<>\n]*>|https?:\/\/[^\s<>)]+/g)) cut(m.index!, m.index! + m[0].length);

	const runs: { from: number; to: number }[] = [];
	for (let i = 0; i < body.length; ) {
		if (out[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j < body.length && !out[j]) j++;
		runs.push({ from: i, to: j });
		i = j;
	}
	return runs;
}

export interface LinkedMention {
	from: number;
	to: number;
	/** The node the mention links to on the map; null for a place doc's name the map doesn't know. */
	node: PlaceNode | null;
}

/**
 * The mentions in `body` the site links, in text order: `Name (1234 m)` references linked to the map, place-doc
 * names, and references naming a place doc (the site puts the doc's marker after them) that no node links.
 */
export function linkedMentions(body: string, places: PlaceIndex | null, docs: PlaceDocIndex | null): LinkedMention[] {
	const out: LinkedMention[] = [];
	for (const run of proseRuns(body)) {
		const text = body.slice(run.from, run.to);
		const linked = findPlaceMentions(text, places);
		for (const m of linked) out.push({ from: run.from + m.from, to: run.from + m.to, node: m.node });
		if (docs)
			for (const m of docMentions(text, docs, places))
				// A reference a node links is underlined once, as that link.
				if (!linked.some((l) => l.from < m.to && m.from < l.to)) out.push({ from: run.from + m.from, to: run.from + m.to, node: m.node });
	}
	return out.sort((a, b) => a.from - b.from);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (e) => Object.keys(ESCAPES).find((k) => ESCAPES[k] === e)!);
const START = '\u0000';
const END = '\u0001';

/**
 * Place-doc names in a prose run, found as the renderer finds them: the doc index's own `markMentions` over the
 * escaped text between `Name (1234 m)` references (a name that is a whole node name links to the node too), and the
 * references whose name words end with a doc's name, from that name on (`node` null: the caller drops the ones a node
 * links).
 */
function docMentions(text: string, docs: PlaceDocIndex, places: PlaceIndex | null): LinkedMention[] {
	// Escaped as the renderer escapes text, with the text offset of every char kept.
	let html = '';
	const at: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const c = text[i] === START || text[i] === END ? ' ' : text[i];
		const e = ESCAPES[c] ?? c;
		html += e;
		for (let k = 0; k < e.length; k++) at.push(i);
	}
	at.push(text.length);

	const out: LinkedMention[] = [];
	const scan = (from: number, to: number) => {
		// Each mention comes back wrapped in markers; their positions, less the markers, are offsets into `html`.
		const marked = docs.markMentions(html.slice(from, to), (t) => START + t + END);
		let p = from;
		let start = -1;
		for (const c of marked) {
			if (c === START) start = p;
			else if (c === END) {
				const words = unescape(html.slice(start, p).replace(/&nbsp;/g, ' ')).split(/\s+/);
				const place = places?.match(words, NaN);
				out.push({ from: at[start], to: at[p], node: place && place.start === 0 ? place.node : null });
			} else p++;
		}
	};
	let last = 0;
	for (const m of html.matchAll(TOPONYM)) {
		scan(last, m.index!);
		const at0 = docReference(m[0], docs);
		if (at0 !== null) out.push({ from: at[m.index! + at0], to: at[m.index! + m[0].length], node: null });
		last = m.index! + m[0].length;
	}
	scan(last, html.length);
	return out;
}

/** Where in a TOPONYM match (escaped HTML) the name of a place doc starts, as the renderer's `docMarker` reads it; or null. */
function docReference(match: string, docs: PlaceDocIndex): number | null {
	// Words and the whitespace between them alternate, as in the renderer's `readReference`.
	const words = match.split(/(\s)/);
	const elevationAt = words.findIndex((w) => w.startsWith('('));
	let start = 0;
	while (start + 2 < elevationAt && LEADING_ENGLISH.has(words[start])) start += 2;
	const nameWords = words.slice(start, elevationAt).filter((_, i) => i % 2 === 0).map(unescape);
	const hit = docs.match(nameWords);
	return hit ? words.slice(0, start + hit.start * 2).join('').length : null;
}

// ---------------------------------------------------------------- underlines

const setMarks = StateEffect.define<LinkedMention[]>();
const mark = Decoration.mark({ class: 'cm-place-mention' });

/** The underlines: replaced by `setMentionMarks`, carried through the edits made in between. */
export const mentionMarks: Extension = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(marks, tr) {
		marks = marks.map(tr.changes);
		for (const e of tr.effects) {
			if (!e.is(setMarks)) continue;
			const len = tr.state.doc.length;
			marks = Decoration.set(e.value.filter((m) => m.to <= len && m.from < m.to).map((m) => mark.range(m.from, m.to)));
		}
		return marks;
	},
	provide: (f) => EditorView.decorations.from(f)
});

export function setMentionMarks(view: EditorView, mentions: LinkedMention[]): void {
	view.dispatch({ effects: setMarks.of(mentions) });
}

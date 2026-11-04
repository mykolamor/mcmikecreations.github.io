/**
 * The Write toolbar and its shortcuts as plain data, and what each formatting
 * command does to the body (an MdChange from the md-lines helpers), free of
 * CodeMirror. Photo, Video, YouTube and Link hike are hooks: the tab runs them
 * (dialogs, searches) instead of a text change.
 */
import { linePrefix, markMissing, wrap, type MdChange } from '../../shared/md-lines';
import { IS_MAC, suggestionKeyNames } from './mentions';

export type HookId = 'photo' | 'video' | 'youtube' | 'hikeLink';
export type CommandId = 'bold' | 'italic' | 'heading' | 'quote' | 'list' | 'link' | 'german' | 'missing' | HookId;

export interface WriteCommand {
	id: CommandId;
	label: string;
	/** The CodeMirror key (`Mod` is Ctrl, Cmd on a Mac). */
	key?: string;
	/** The shortcut as the overlay shows it. */
	shortcut?: string;
	/** Stays in the toolbar on a phone; the rest go into "More". */
	primary: boolean;
	/** Run by the tab (Tasks 8–9), not a text change. */
	hook?: true;
}

export const COMMANDS: WriteCommand[] = [
	{ id: 'bold', label: 'Bold', key: 'Mod-b', shortcut: 'Ctrl+B', primary: true },
	{ id: 'italic', label: 'Italic', key: 'Mod-i', shortcut: 'Ctrl+I', primary: true },
	{ id: 'heading', label: 'Heading', key: 'Mod-Alt-2', shortcut: 'Ctrl+Alt+2', primary: false },
	{ id: 'quote', label: 'Quote', primary: false },
	{ id: 'list', label: 'List', primary: false },
	{ id: 'link', label: 'Link', key: 'Mod-k', shortcut: 'Ctrl+K', primary: true },
	{ id: 'german', label: 'German', key: 'Mod-Alt-g', shortcut: 'Ctrl+Alt+G', primary: false },
	{ id: 'missing', label: 'Missing', key: 'Mod-Alt-m', shortcut: 'Ctrl+Alt+M', primary: false },
	{ id: 'photo', label: 'Photo', primary: true, hook: true },
	{ id: 'video', label: 'Video', primary: false, hook: true },
	{ id: 'youtube', label: 'YouTube', primary: false, hook: true },
	// `[[` is typed, not a key binding: Task 9 watches the input for it.
	{ id: 'hikeLink', label: 'Link hike', shortcut: '[[', primary: false, hook: true }
];

const MEDIA: CommandId[] = ['photo', 'video', 'youtube'];

/**
 * The commands a doc offers: a place doc has no videos, so no YouTube; a translation adds no media at all (they are
 * added in English first, and the translation copies their lines).
 */
export function commandsFor(kind: 'post' | 'hike' | 'place' | 'translation'): WriteCommand[] {
	if (kind === 'translation') return COMMANDS.filter((c) => !MEDIA.includes(c.id));
	return COMMANDS.filter((c) => c.id !== 'youtube' || kind !== 'place');
}

/** Every shortcut for the Ctrl+/ overlay: the commands', then the editor's own and the place suggestion list's. */
export function shortcutList(commands: WriteCommand[] = COMMANDS, mac = IS_MAC): { label: string; shortcut: string }[] {
	const suggest = suggestionKeyNames(mac);
	return [
		...commands.filter((c) => c.shortcut).map((c) => ({ label: c.label, shortcut: c.shortcut! })),
		{ label: 'Undo', shortcut: 'Ctrl+Z' },
		{ label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
		{ label: 'Find / replace', shortcut: 'Ctrl+F' },
		{ label: 'Next place suggestion', shortcut: suggest.next },
		{ label: 'Previous place suggestion', shortcut: suggest.previous },
		{ label: 'Insert the highlighted place', shortcut: suggest.accept },
		{ label: 'Close the suggestions', shortcut: suggest.close },
		{ label: 'This list', shortcut: 'Ctrl+/' }
	];
}

/**
 * The lines a selection touches (start offset and text without the line
 * break), as linePrefix takes them. A selection ending at the very start of a
 * line leaves that line out, as editors do.
 */
export function selectedLines(body: string, from: number, to: number): { from: number; text: string }[] {
	const end = to > from && (body[to - 1] === '\n') ? to - 1 : to;
	const lines: { from: number; text: string }[] = [];
	let start = body.lastIndexOf('\n', from - 1) + 1;
	for (;;) {
		const nl = body.indexOf('\n', start);
		const stop = nl === -1 ? body.length : nl;
		lines.push({ from: start, text: body.slice(start, stop > start && body[stop - 1] === '\r' ? stop - 1 : stop) });
		if (nl === -1 || nl >= end) return lines;
		start = nl + 1;
	}
}

/** `[selection]()` with the cursor in the parentheses, or `[]()` with it in the brackets. */
function link(body: string, from: number, to: number): MdChange {
	const text = body.slice(from, to);
	const at = text ? from + text.length + 3 : from + 1;
	return { from, to, insert: `[${text}]()`, selFrom: at, selTo: at };
}

/** The text change a command makes on the selection; null for hooks and when there is nothing to do. */
export function commandChange(id: CommandId, sel: { body: string; from: number; to: number }): MdChange | null {
	const { body, from, to } = sel;
	switch (id) {
		case 'bold':
			return wrap(sel, '**', '**');
		case 'italic':
			return wrap(sel, '_', '_');
		case 'german':
			return wrap(sel, '<span lang="de">', '</span>');
		case 'heading':
			return linePrefix(selectedLines(body, from, to), '## ');
		case 'quote':
			return linePrefix(selectedLines(body, from, to), '> ');
		case 'list':
			return linePrefix(selectedLines(body, from, to), '- ');
		case 'link':
			return link(body, from, to);
		case 'missing':
			return markMissing(body, { from, to });
		default:
			return null;
	}
}

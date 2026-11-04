/**
 * The Write editor: CodeMirror 6 over the body text exactly as it is on disk.
 * Soft wrap only (no reflow, no markup continuation on Enter), undo history,
 * search, markdown highlighting. `\n` is the only line break, so the text
 * comes back byte for byte (a stray `\r` stays a character of its line).
 */
import { Annotation, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, showPanel, type Panel } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { MdChange } from '../../shared/md-lines';
import { COMMANDS, type CommandId } from './commands';

/** Marks a change that came from the server, so it isn't reported as the author's edit. */
const fromServer = Annotation.define<boolean>();

export type WriteEditor = ReturnType<typeof createEditor>;

/** "Ln 3, Col 14" at the main cursor (both 1-based, columns in characters), plus "(5 selected)" for a selection. */
export function cursorLabel(state: EditorState): string {
	const { head, from, to } = state.selection.main;
	const line = state.doc.lineAt(head);
	const pos = `Ln ${line.number}, Col ${head - line.from + 1}`;
	return to > from ? `${pos} (${to - from} selected)` : pos;
}

/** The status line under the text: where the cursor is. */
function cursorPanel(view: EditorView): Panel {
	const dom = document.createElement('div');
	dom.className = 'cm-cursor-pos';
	dom.textContent = cursorLabel(view.state);
	return {
		dom,
		top: false,
		update(u) {
			if (u.selectionSet || u.docChanged) dom.textContent = cursorLabel(u.state);
		}
	};
}

export function createEditor(
	parent: HTMLElement,
	opts: {
		text: string;
		/** The author changed the text (not called for `setText`). */
		onChange: () => void;
		/** Runs a toolbar command by its shortcut. */
		run: (id: CommandId) => void;
		/** Ctrl+/ */
		onKeys: () => void;
		/** More extensions (Tasks 8–9: media chips, mentions, `[[`). */
		extensions?: Extension[];
	}
) {
	const commandKeys = COMMANDS.filter((c) => c.key).map((c) => ({
		key: c.key!,
		preventDefault: true,
		run: () => (opts.run(c.id), true)
	}));
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: opts.text,
			extensions: [
				EditorState.lineSeparator.of('\n'),
				// Pasted Windows text would bring `\r`s along, and the body is saved byte for byte: the posts keep LF line ends.
				// (The server refuses only CRLF front-matter fences; a `\r` in the body would be written as it is.)
				EditorView.clipboardInputFilter.of((t) => t.replace(/\r\n?/g, '\n')),
				EditorView.lineWrapping,
				lineNumbers(),
				highlightActiveLineGutter(),
				EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'Text' }),
				history(),
				search({ top: true }),
				showPanel.of(cursorPanel),
				highlightSelectionMatches(),
				highlightSpecialChars(),
				markdown({ base: markdownLanguage, addKeymap: false }),
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				Prec.high(keymap.of([...commandKeys, { key: 'Mod-/', preventDefault: true, run: () => (opts.onKeys(), true) }])),
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.some((t) => t.annotation(fromServer))) opts.onChange();
				}),
				...(opts.extensions ?? [])
			]
		})
	});

	return {
		view,
		getText: () => view.state.doc.toString(),
		/** Replaces the text with the server's, changing only the span that differs so the cursor and scroll stay. */
		setText(text: string) {
			const cur = view.state.doc.toString();
			if (cur === text) return;
			let p = 0;
			const max = Math.min(cur.length, text.length);
			while (p < max && cur[p] === text[p]) p++;
			let q = 0;
			while (q < max - p && cur[cur.length - 1 - q] === text[text.length - 1 - q]) q++;
			view.dispatch({
				changes: { from: p, to: cur.length - q, insert: text.slice(p, text.length - q) },
				// Undo steps over it: undoing someone else's change would save it away.
				annotations: [fromServer.of(true), Transaction.addToHistory.of(false)]
			});
		},
		/** Applies a command's change as one undoable step and focuses the editor. */
		apply(change: MdChange) {
			view.dispatch({
				changes: { from: change.from, to: change.to, insert: change.insert },
				selection: { anchor: change.selFrom, head: change.selTo },
				scrollIntoView: true,
				userEvent: 'input.format'
			});
			view.focus();
		},
		/** The text and the main selection, as the commands take them. */
		selection() {
			const { from, to } = view.state.selection.main;
			return { body: view.state.doc.toString(), from, to };
		},
		destroy: () => view.destroy()
	};
}

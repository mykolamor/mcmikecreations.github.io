// The Write editor's DeepL drafts: the blocks Fill put into the translation, marked until the author edits one (an
// edit touching a mark drops it) or the editor is made anew. Set from the drafts kept per doc (drafts.svelte.ts). Each
// is dashed (fill/drafts.css) and opens with a small "DeepL draft" label.
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

const setMarks = StateEffect.define<{ from: number; to: number }[]>();
const mark = Decoration.mark({ class: 'cm-deepl-draft', attributes: { title: 'DeepL draft' } });

class BadgeWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'cm-deepl-draft-badge';
		el.textContent = 'DeepL draft';
		return el;
	}
}
const badge = Decoration.widget({ widget: new BadgeWidget(), side: -1 });

/** The marks with a label at the start of each. */
function withBadges(marks: DecorationSet): DecorationSet {
	const badges = [];
	for (const it = marks.iter(); it.value; it.next()) badges.push(badge.range(it.from));
	return marks.update({ add: badges, sort: true });
}

export const draftMarks: Extension = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(marks, tr) {
		if (tr.docChanged) {
			const touched: [number, number][] = [];
			tr.changes.iterChangedRanges((from, to) => touched.push([from, to]));
			// Inside a mark only: a line break typed right after a block (or before it) leaves it a draft.
			marks = marks.update({ filter: (from, to) => !touched.some(([a, b]) => a < to && from < b) }).map(tr.changes);
		}
		for (const e of tr.effects) {
			if (!e.is(setMarks)) continue;
			const len = tr.state.doc.length;
			marks = Decoration.set(e.value.filter((m) => m.to <= len && m.from < m.to).map((m) => mark.range(m.from, m.to)));
		}
		return marks;
	},
	provide: (f) => EditorView.decorations.from(f, withBadges)
});

export function setDraftMarks(view: EditorView, ranges: { from: number; to: number }[]): void {
	view.dispatch({ effects: setMarks.of(ranges) });
}

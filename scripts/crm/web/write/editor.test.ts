import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState } from '@codemirror/state';
import { cursorLabel } from './editor';

test('the cursor label counts lines and characters from 1', () => {
	const doc = 'Hello\nSecond line\n';
	const at = (anchor: number, head = anchor) => cursorLabel(EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }));
	assert.equal(at(0), 'Ln 1, Col 1');
	assert.equal(at(5), 'Ln 1, Col 6', 'at the end of the line');
	assert.equal(at(9), 'Ln 2, Col 4');
	assert.equal(at(doc.length), 'Ln 3, Col 1', 'after the last line break');
	assert.equal(at(2, 9), 'Ln 2, Col 4 (7 selected)', 'the head is where the cursor is');
	assert.equal(at(9, 2), 'Ln 1, Col 3 (7 selected)');
});

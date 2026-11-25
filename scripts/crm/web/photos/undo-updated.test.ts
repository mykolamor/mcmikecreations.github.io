import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undoUpdatedOp } from './undo-updated';
import { applyOps } from '../../shared/ops';
import { docVersion, type HikeDoc } from '../../server/doc';

const SIDE = '{\n  "name": "N"\n}\n';
const mk = (postRaw: string): HikeDoc => ({ slug: 's', date: '2024-01-01', sidecarRaw: SIDE, postRaw, version: docVersion(SIDE, postRaw) });

test('undo puts the previous updated date back, or removes the key the stamp added', () => {
	const out = applyOps(mk('---\ntitle: T\nupdated: 2030-01-02\n---\nB\n'), [undoUpdatedOp('2023-03-03')]);
	assert.equal(out.postRaw, '---\ntitle: T\nupdated: 2023-03-03\n---\nB\n');
	assert.deepEqual(undoUpdatedOp(undefined), { field: 'post.updated', value: null });
	const removed = applyOps(mk('---\ntitle: T\nupdated: 2030-01-02\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nB\n'), [undoUpdatedOp(null)]);
	assert.equal(removed.postRaw, '---\ntitle: T\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nB\n');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldOp } from '../../shared/ops';
import { editOp, REMOVE } from './facts-state';
import { latestOnly, previewDraft, previewIndex } from './preview';

const doc = { facts: { hike: { summary: 'Hike', water: [{ at: 'Hut' }] }, post: { summary: 'Visit' } } };
const post = { kind: 'post' as const, slug: 'x', date: '2026-07-01' };

test('the draft holds only edited scopes', () => {
	const settings: FieldOp = { field: 'title', value: 'T' } as FieldOp;
	assert.deepEqual(previewDraft(doc, [], post), {});
	assert.deepEqual(previewDraft(doc, [settings], post), {}, 'an op on another field is no facts edit');
	assert.deepEqual(previewDraft(doc, [editOp('post', ['summary'], 'New')], post), { post: { summary: { en: 'New' } } });
	assert.deepEqual(previewDraft(doc, [editOp('hike', ['water', 0, 'note'], 'n'), editOp('post', ['summary'], 'New')], post), {
		hike: { summary: 'Hike', water: [{ at: 'Hut', note: { en: 'n' } }] },
		post: { summary: { en: 'New' } }
	});
	// An edit that leaves a scope no facts is sent as none (null), never left out, which would read the file's.
	assert.deepEqual(previewDraft(doc, [editOp('post', ['summary'], REMOVE)], post), { post: null });
	// A visit's removal of a text (null) is carried.
	assert.deepEqual(previewDraft(doc, [editOp('post', ['summary'], null)], post), { post: { summary: null } });
	// A hike without a post previews its sidecar alone.
	assert.deepEqual(previewDraft(doc, [editOp('post', ['summary'], 'New')], { kind: 'hike', slug: 'x' }), {});
	assert.equal(doc.facts.hike.water.length, 1, 'the doc is untouched');
});

test('a slower older response does not replace a newer one', async () => {
	const shown: string[] = [];
	const run = latestOnly<string>((v) => shown.push(v), (e) => shown.push(`error: ${e}`));
	const later = <T>() => {
		let resolve!: (v: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
		return { promise, resolve, reject };
	};
	const [a, b, c] = [later<string>(), later<string>(), later<string>()];
	const done = [run(a.promise), run(b.promise), run(c.promise)];
	b.resolve('second');
	await done[1];
	a.resolve('first');
	await done[0];
	assert.deepEqual(shown, ['second'], 'the first answered after the second: dropped');
	c.reject('down');
	await done[2];
	assert.deepEqual(shown, ['second', 'error: down'], 'a failure of the newest shows');
	// In order, each answer shows.
	const d = later<string>();
	const e = later<string>();
	const more = [run(d.promise), run(e.promise)];
	d.resolve('fourth');
	await more[0];
	e.resolve('fifth');
	await more[1];
	assert.deepEqual(shown.slice(2), ['fourth', 'fifth']);
});

test('a hike entry selected in a post doc is found in the merged list', () => {
	const hike = [{ to: 'A' }, { to: 'B' }, { to: 'C' }];
	assert.equal(previewIndex('post', 2, hike, [{ to: 'D' }], true), 2, 'this visit selects in the merged list already');
	assert.equal(previewIndex('hike', 2, hike, undefined, false), 2);
	assert.equal(previewIndex('hike', 2, hike, undefined, true), 2);
	// The visit hides B: C comes one earlier, B is nowhere.
	assert.equal(previewIndex('hike', 2, hike, [{ to: 'B', remove: true }], true), 1);
	assert.equal(previewIndex('hike', 1, hike, [{ to: 'B', remove: true }], true), null);
	// The visit's own list replaced with none.
	assert.equal(previewIndex('hike', 0, hike, null, true), null);
	assert.equal(previewIndex('hike', null, hike, undefined, true), null);
});

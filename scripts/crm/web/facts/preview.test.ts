import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFactsOverlay } from '$lib/hikes/facts-overlay';
import { readHikeFacts } from '$lib/hikes/facts.server';
import type { FieldOp } from '../../shared/ops';
import { editOp, REMOVE } from './facts-state';
import { highlightBand, latestOnly, previewDraft, previewIndex } from './preview';

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

// The site's reading of a route list, and the overlay it draws.
const nodes = [{ ref: 'node/1', lat: 47.5, lon: 11.51, tags: { name: 'Hut' } }, { ref: 'node/2', lat: 47.5, lon: 11.52, tags: { name: 'Ridge' } }];
const coords = [[11.5, 47.5, 1000], [11.51, 47.5, 1200], [11.52, 47.5, 1300], [11.53, 47.5, 1250]];
const legs = [{ to: 'Hut', sac: 'T2' }, { from: 'Hut', to: 'Ridge', inTable: false, onProfile: true, sac: 'T4' }, { to: 'Ridge', onProfile: true }, { from: 'Ridge', inTable: false, onProfile: true, sac: 'T1' }];
const facts = readHikeFacts({ sidecar: { legs }, post: undefined, postSource: 'p', sidecarSource: 's', nodes, coords, distanceFactor: 1.1 }).facts;

test('the highlight band spans the selected entry', () => {
	const overlay = buildFactsOverlay(facts, 'en', coords, 1.1);
	const profile = overlay.bands.filter((b) => b.row === 0);
	const selected = (i: number) => highlightBand(facts, i, coords, 1.1);
	// An entry on the profile: its band's stretch.
	assert.deepEqual(selected(1), { from: profile[0].from, to: profile[0].to, row: 1, color: '#e65100', title: 'Selected' });
	assert.deepEqual([selected(2)!.from, selected(2)!.to], [profile[1].from, profile[1].to]);
	// One with no end runs to the route's end.
	assert.deepEqual([selected(3)!.from, selected(3)!.to], [profile[2].from, profile[2].to]);
	assert.ok(profile[2].to > profile[2].from);
	// A table-only entry: its resolved ends, the first table entry from the start.
	const hut = facts!.legs![0].to!.km!;
	assert.ok(hut > 0);
	assert.deepEqual([selected(0)!.from, selected(0)!.to], [0, hut]);
	// Nothing selected, or no such entry: no band.
	assert.equal(highlightBand(facts, null, coords, 1.1), null);
	assert.equal(highlightBand(facts, 9, coords, 1.1), null);
	assert.equal(highlightBand(null, 0, coords, 1.1), null);
	// An end not on the route: no band.
	const off = readHikeFacts({ sidecar: { legs: [{ to: 'Nowhere' }] }, post: undefined, postSource: 'p', sidecarSource: 's', nodes, coords, distanceFactor: 1 }).facts;
	assert.equal(highlightBand(off, 0, coords, 1), null);
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

test('the draft carries a visit\'s removal of a text', () => {
	assert.deepEqual(previewDraft(doc, [editOp('post', ['summary'], null)], post), { post: { summary: null } });
});

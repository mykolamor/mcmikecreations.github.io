import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHikeFacts } from '$lib/hikes/facts.server';
import { specAt, type Spec } from '$lib/hikes/facts-spec';
import type { FieldOp } from '../../shared/ops';
import { localFacts } from './facts-state';
import { inheritedRows } from './inherit';
import { chained, insertOp, mergedBefore, routeRows, selectionAfterInsert, selectionAfterMove, selectionAfterRemove, toggleOps, visitLegs } from './route-list';

const legs = [
	{ to: 'Hut', sac: 'T2' },
	{ from: 'Hut', to: 'Ridge', inTable: false, onProfile: true, sac: 'T4' },
	{ inTable: false, onProfile: true, sac: 'T3' },
	{ to: 'Ridge', onProfile: true },
	{ to: { km: 3 } }
];

test('table entries chain their from', () => {
	assert.deepEqual(routeRows(legs), [
		{ index: 0, from: 'Start', to: 'Hut', kind: 'table' },
		{ index: 1, from: 'Hut', to: 'Ridge', kind: 'profile' },
		// A profile-only entry's absent ends are the route's.
		{ index: 2, from: 'Start', to: 'End', kind: 'profile' },
		// A table entry starts where the previous table entry ended; the profile-only ones between don't count.
		{ index: 3, from: 'Hut', to: 'Ridge', kind: 'both' },
		{ index: 4, from: 'Ridge', to: 'km 3', kind: 'table' }
	]);
	assert.deepEqual(chained(legs)[3].from, 'Hut');
	assert.equal('from' in chained(legs)[0], false, 'the first table entry starts at the start: no from');
	assert.deepEqual(routeRows([]), []);
});

// The site's reading of the hike's facts with the ops applied.
const nodes = [{ ref: 'node/1', lat: 47.5, lon: 11.5, tags: { name: 'Hut' } }, { ref: 'node/2', lat: 47.51, lon: 11.51, tags: { name: 'Ridge' } }];
const coords = [[11.5, 47.5, 1000], [11.51, 47.51, 1200], [11.52, 47.52, 1300]];
function site(list: unknown[], ops: FieldOp[]) {
	const facts = localFacts({ facts: { hike: { legs: list }, post: null } }, ops, 'hike') as { legs: Record<string, unknown>[] };
	const r = readHikeFacts({ sidecar: facts, post: undefined, postSource: 'post', sidecarSource: 'side', nodes, coords, distanceFactor: 1 });
	return { written: facts.legs, read: r.facts?.legs };
}

test('turning inTable off writes from and onProfile', () => {
	const list = [{ to: 'Hut' }, { to: 'Ridge', sac: 'T3' }];
	const ops = toggleOps('hike', 1, 'inTable', false, chained(list)[1]);
	assert.deepEqual(ops, [
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'inTable'], value: false },
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'onProfile'], value: true },
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'from'], value: 'Hut' }
	]);
	// The site reads it as a band of its own over the same stretch.
	const { written, read } = site(list, ops);
	assert.deepEqual(written[1], { to: 'Ridge', sac: 'T3', inTable: false, onProfile: true, from: 'Hut' });
	assert.equal(read?.length, 2);
	assert.deepEqual([read![1].inTable, read![1].onProfile], [false, true]);
	// The first table entry starts at the start: no `from` to write, its absence is the start.
	const first = toggleOps('post', 0, 'inTable', false, chained(list)[0]);
	assert.deepEqual(first, [
		{ kind: 'facts', scope: 'post', path: ['legs', 0, 'inTable'], value: false },
		{ kind: 'facts', scope: 'post', path: ['legs', 0, 'onProfile'], value: true }
	]);
	assert.equal(site(list, toggleOps('hike', 0, 'inTable', false, chained(list)[0])).read?.length, 2);
});

test('defaults are written by removing the key', () => {
	const list = [{ to: 'Hut' }, { from: 'Hut', to: 'Ridge', inTable: false, onProfile: true }, { to: 'Ridge', onProfile: true }];
	const rows = chained(list);
	// In the table again: `inTable` and `from` go (a table entry chains its from), `onProfile` stays.
	const back = toggleOps('hike', 1, 'inTable', true, rows[1]);
	assert.deepEqual(back, [
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'inTable'], remove: true },
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'from'], remove: true }
	]);
	assert.deepEqual(site(list, back).written[1], { to: 'Ridge', onProfile: true });
	// Off the profile: the key goes, never `onProfile: false`.
	assert.deepEqual(toggleOps('hike', 2, 'onProfile', false, rows[2]), [{ kind: 'facts', scope: 'hike', path: ['legs', 2, 'onProfile'], remove: true }]);
	assert.deepEqual(toggleOps('hike', 0, 'onProfile', true, rows[0]), [{ kind: 'facts', scope: 'hike', path: ['legs', 0, 'onProfile'], value: true }]);
	// An entry off the table is on the profile, or it shows nowhere: off the profile, it goes back into the table.
	assert.deepEqual(toggleOps('hike', 1, 'onProfile', false, rows[1]), [
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'onProfile'], remove: true },
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'inTable'], remove: true },
		{ kind: 'facts', scope: 'hike', path: ['legs', 1, 'from'], remove: true }
	]);
	// No toggle ever writes a default.
	for (const [i, flag, on] of [[0, 'inTable', true], [0, 'onProfile', false], [1, 'inTable', true], [2, 'onProfile', false]] as const) {
		for (const op of toggleOps('hike', i, flag, on, rows[i])) {
			const key = op.path[op.path.length - 1];
			assert.ok(!('value' in op) || !((key === 'inTable' && op.value === true) || (key === 'onProfile' && op.value === false)), `${i} ${flag}`);
		}
	}
});

test('an entry added after another is inserted, its texts normalised and the others as they are', () => {
	const list = [{ to: 'Hut', note: { en: 'kept as written' } }, { to: 'Ridge' }];
	assert.deepEqual(insertOp('post', list, 1, { to: 'Saddle', note: { en: 'New', de: '' } }), {
		kind: 'facts',
		scope: 'post',
		path: ['legs'],
		value: [{ to: 'Hut', note: { en: 'kept as written' } }, { to: 'Saddle', note: { en: 'New' } }, { to: 'Ridge' }]
	});
	assert.deepEqual(list.length, 2, 'the list is untouched');
});

test("a visit's note merges with the hike's per language, as the site's", () => {
	const spec = specAt(['legs']) as Extract<Spec, { t: 'list' }>;
	const hike = [{ to: 'Hut', note: { en: 'Steep', de: 'Steil' } }, { to: 'Ridge' }];
	const post = [{ to: 'Hut', note: 'Very steep' }];
	assert.deepEqual(visitLegs(spec, inheritedRows(spec, hike, post)), [{ to: 'Hut', note: { en: 'Very steep', de: 'Steil' } }, { to: 'Ridge' }]);
	const r = readHikeFacts({ sidecar: { legs: hike }, post: { legs: post }, postSource: 'post', sidecarSource: 'side', nodes, coords, distanceFactor: 1 });
	assert.deepEqual(r.facts?.legs?.[0].note, { en: 'Very steep', de: 'Steil' });
});

test('the selection follows its entry through a move, a removal and an insertion', () => {
	// The moved entry itself, and those it passes, which shift by one.
	assert.equal(selectionAfterMove(1, 1, 3), 3);
	assert.equal(selectionAfterMove(2, 1, 3), 1);
	assert.equal(selectionAfterMove(3, 1, 3), 2);
	assert.equal(selectionAfterMove(2, 3, 1), 3);
	assert.equal(selectionAfterMove(0, 1, 3), 0);
	assert.equal(selectionAfterMove(4, 3, 1), 4);
	assert.equal(selectionAfterMove(null, 1, 3), null);
	// A removed selected entry clears it; the entries after it shift up.
	assert.equal(selectionAfterRemove(2, 2), null);
	assert.equal(selectionAfterRemove(3, 2), 2);
	assert.equal(selectionAfterRemove(1, 2), 1);
	assert.equal(selectionAfterRemove(null, 2), null);
	// An entry showing again (a hidden one undone) shifts those from its place down.
	assert.equal(selectionAfterInsert(2, 2), 3);
	assert.equal(selectionAfterInsert(1, 2), 1);
	assert.equal(selectionAfterInsert(null, 0), null);
	// Each agrees with the list spliced the same way.
	const list = ['a', 'b', 'c', 'd', 'e'];
	for (let from = 0; from < 5; from++)
		for (let to = 0; to < 5; to++)
			for (let sel = 0; sel < 5; sel++) {
				const next = [...list];
				next.splice(to, 0, ...next.splice(from, 1));
				assert.equal(next[selectionAfterMove(sel, from, to)!], list[sel], `${sel} ${from}→${to}`);
			}
});

test('a hidden row shows again at the count of merged rows before it', () => {
	const shown = [{ merged: 0 }, { merged: null }, { merged: 1 }, { merged: null }, { merged: 2 }];
	assert.equal(mergedBefore(shown, 0), 0);
	assert.equal(mergedBefore(shown, 1), 1);
	assert.equal(mergedBefore(shown, 3), 2, 'another hidden row before it does not count');
	assert.equal(mergedBefore(shown, 5), 3);
	// Undoing the hide of row 3 with the third merged entry selected: the selection moves down past it.
	assert.equal(selectionAfterInsert(2, mergedBefore(shown, 3)), 3);
	assert.equal(selectionAfterInsert(1, mergedBefore(shown, 3)), 1);
});

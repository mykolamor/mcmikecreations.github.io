import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specAt, type Spec } from '$lib/hikes/facts-spec';
import { byEntry, hideOp, inheritedRows, overrideOp, unhideOp } from './inherit';
import { editOp, localFacts } from './facts-state';
import { readHikeFacts } from '$lib/hikes/facts.server';

type List = Extract<Spec, { t: 'list' }>;
const list = (path: (string | number)[]) => specAt(path) as List;

test('rows pair sidecar and post entries by identity', () => {
	const water = list(['water']);
	const hike = [{ at: 'Quelle', kind: 'spring' }, { at: 'Hut', kind: 'tap' }, { at: 'Brunnen' }];
	const post = [{ at: 'Lake', note: 'new' }, { at: 'Hut', remove: true }, { at: 'Quelle', note: 'dry' }];
	const rows = inheritedRows(water, hike, post);
	assert.deepEqual(
		rows.map((r) => [r.hike?.at ?? null, r.post?.at ?? null, r.removed, r.postAt]),
		[
			['Quelle', 'Quelle', false, 2],
			['Hut', 'Hut', true, 1],
			['Brunnen', null, false, 3],
			// The post's own entry comes after the sidecar's, as in the merge.
			[null, 'Lake', false, 0]
		]
	);
	assert.equal(rows[0].key, rows.find((r) => r.post?.note === 'dry')!.key);
	// A text identity matches written either way; no post at all inherits every entry.
	const permits = list(['permits']);
	const paired = inheritedRows(permits, [{ name: 'Pass' }], [{ name: { en: 'Pass', de: 'Ausweis' }, required: true }]);
	assert.equal(paired.length, 1);
	assert.equal(paired[0].post?.required, true);
	assert.deepEqual(inheritedRows(water, hike, undefined).map((r) => [r.post, r.postAt]), [[undefined, 0], [undefined, 0], [undefined, 0]]);
});

test('overriding one field of an inherited entry writes its identity fields', () => {
	const water = list(['water']);
	const hike = [{ at: 'Hut', kind: 'tap' }, { at: 'Quelle', kind: 'spring', reliable: 'always' }];
	const post = [{ at: 'Hut', note: 'closed' }];
	const [, quelle] = inheritedRows(water, hike, post);
	const op = overrideOp(water, ['water'], quelle, 'note', 'Dry in August');
	assert.deepEqual(op, { kind: 'facts', scope: 'post', path: ['water', 1], value: { at: 'Quelle', note: { en: 'Dry in August' } } });
	// Merged by the queue's local view, it pairs with the hike's entry instead of making a second one.
	const after = localFacts({ facts: { hike: { water: hike }, post: { water: post } } }, [op], 'post') as { water: unknown[] };
	const rows = inheritedRows(water, hike, after.water as Record<string, unknown>[]);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[1].post?.note, { en: 'Dry in August' });
	// A further field goes into that entry by its index.
	assert.deepEqual(overrideOp(water, ['water'], rows[1], 'treat', true), { kind: 'facts', scope: 'post', path: ['water', 1, 'treat'], value: true });
	// A first override with no post list starts it; an entry using a shared record carries its `use`.
	const transport = list(['access', 'transport']);
	const [bus] = inheritedRows(transport, [{ use: 'bus-123', mode: 'bus', from: 'A', to: 'B', line: '123' }], undefined);
	assert.deepEqual(overrideOp(transport, ['access', 'transport'], bus, 'note', 'Late'), {
		kind: 'facts', scope: 'post', path: ['access', 'transport', 0], value: { use: 'bus-123', mode: 'bus', from: { en: 'A' }, to: 'B', note: { en: 'Late' } }
	});
	// Parking by name, or by place when it has none.
	const parking = list(['access', 'parking']);
	const [named, placed] = inheritedRows(parking, [{ name: 'P1', at: 'Lot', size: 'small' }, { at: 'Field', size: 'large' }], undefined);
	assert.deepEqual(overrideOp(parking, ['access', 'parking'], named, 'size', 'large').value, { name: { en: 'P1' }, size: 'large' });
	assert.deepEqual(overrideOp(parking, ['access', 'parking'], placed, 'size', 'small').value, { at: 'Field', size: 'small' });
});

test('a route-list override keeps table and profile identities apart', () => {
	const legs = list(['legs']);
	const hike = [
		{ from: 'Start', to: 'Hut', sac: 'T2' },
		{ from: 'Start', to: 'Hut', inTable: false, onProfile: true, marking: 'red' }
	];
	const [table, profile] = inheritedRows(legs, hike, undefined);
	assert.notEqual(table.key, profile.key);
	assert.deepEqual(overrideOp(legs, ['legs'], table, 'note', 'Steep').value, { to: 'Hut', note: { en: 'Steep' } });
	assert.deepEqual(overrideOp(legs, ['legs'], profile, 'note', 'Wet').value, { from: 'Start', to: 'Hut', inTable: false, note: { en: 'Wet' } });
	// Each override pairs with its own entry.
	const post = [overrideOp(legs, ['legs'], profile, 'note', 'Wet').value, { ...(overrideOp(legs, ['legs'], table, 'note', 'Steep').value as object) }] as Record<string, unknown>[];
	const rows = inheritedRows(legs, hike, post);
	assert.deepEqual(rows.map((r) => r.post?.note), [{ en: 'Steep' }, { en: 'Wet' }]);
});

test('hide writes remove:true and undo deletes it', () => {
	const hazards = list(['hazards']);
	const hike = [{ kind: 'scree', from: 'A', to: 'B', severity: 'high', note: 'Loose' }];
	const [row] = inheritedRows(hazards, hike, [{ kind: 'other' }]);
	const hide = hideOp(hazards, ['hazards'], row);
	assert.deepEqual(hide, { kind: 'facts', scope: 'post', path: ['hazards', 1], value: { kind: 'scree', from: 'A', to: 'B', remove: true } });
	const post = (localFacts({ facts: { hike: { hazards: hike }, post: { hazards: [{ kind: 'other' }] } } }, [hide], 'post') as { hazards: Record<string, unknown>[] }).hazards;
	const [hidden] = inheritedRows(hazards, hike, post);
	assert.equal(hidden.removed, true);
	assert.deepEqual(unhideOp(['hazards'], hidden), { kind: 'facts', scope: 'post', path: ['hazards', 1], remove: true });
	// Hiding an entry the visit already overrides replaces the override in place.
	const [overridden] = inheritedRows(hazards, hike, [{ kind: 'scree', from: 'A', to: 'B', note: 'Worse' }]);
	assert.deepEqual(hideOp(hazards, ['hazards'], overridden), { kind: 'facts', scope: 'post', path: ['hazards', 0], value: { kind: 'scree', from: 'A', to: 'B', remove: true } });
});

test('a list without identity is replaced whole', () => {
	assert.equal(byEntry(list(['water'])), true);
	assert.equal(byEntry(list(['legs'])), true);
	for (const path of [['route', 'trails'], ['season', 'best'], ['route', 'terrain'], ['stops', 0, 'price'], ['plan', 'for']]) assert.equal(byEntry(list(path)), false, path.join('.'));
	// "Own list for this visit" sets the post's list as a copy of the hike's; the merge then takes it in place of the hike's.
	const trails = ['E5', '201'];
	const op = editOp('post', ['route', 'trails'], structuredClone(trails));
	assert.deepEqual(op, { kind: 'facts', scope: 'post', path: ['route', 'trails'], value: ['E5', '201'] });
	assert.deepEqual(localFacts({ facts: { hike: { route: { trails } }, post: null } }, [op, editOp('post', ['route', 'trails', 2], 'E4')], 'post'), { route: { trails: ['E5', '201', 'E4'] } });
	assert.throws(() => inheritedRows(list(['route', 'trails']), trails, undefined), /replaced whole/);
});

// The site's merge, on the same files: a hike with two named nodes and a short route.
const nodes = [{ ref: 'node/1', lat: 47.5, lon: 11.5, tags: { name: 'Quelle' } }, { ref: 'node/2', lat: 47.51, lon: 11.51, tags: { name: 'Hut' } }];
const coords = [[11.5, 47.5, 1000], [11.51, 47.51, 1200], [11.52, 47.52, 1300]];
function siteList(path: string[], sidecar: unknown, post: unknown): unknown[] {
	const wrap = (v: unknown) => path.reduceRight<unknown>((a, k) => ({ [k]: a }), v);
	const r = readHikeFacts({ sidecar: wrap(sidecar), post: wrap(post), postSource: 'post', sidecarSource: 'side', nodes, coords, distanceFactor: 1 });
	let v: unknown = r.facts;
	for (const k of path) v = (v as Record<string, unknown> | undefined)?.[k];
	return v as unknown[];
}
const shown = (path: string[], sidecar: unknown[], post: unknown[]) => inheritedRows(list(path), sidecar, post).filter((r) => !r.removed);

test('rows pair entries as the site merge does', () => {
	const cases: [string, string[], unknown[], unknown[]][] = [
		['exact', ['water'], [{ at: 'Quelle' }], [{ at: 'Quelle', note: 'x' }]],
		['case, unresolved', ['water'], [{ at: 'Brunnen' }], [{ at: 'brunnen', note: 'x' }]],
		['case, resolved', ['water'], [{ at: 'Quelle' }], [{ at: 'quelle', note: 'x' }]],
		['trailing space', ['water'], [{ at: 'Brunnen' }], [{ at: 'Brunnen ', note: 'x' }]],
		['km string vs {km}', ['water'], [{ at: 'km 1' }], [{ at: { km: 1 }, note: 'x' }]],
		['km beyond the route', ['water'], [{ at: 'km 9' }], [{ at: 'KM 9', note: 'x' }]],
		['lat/lon', ['water'], [{ at: { lat: 47.5, lon: 11.5 } }], [{ at: { lat: 47.50001, lon: 11.50001 }, note: 'x' }]],
		['two post entries over one', ['water'], [{ at: 'Quelle' }], [{ at: 'Quelle', note: 'x' }, { at: 'Quelle', treat: true }]],
		['two new post entries', ['water'], [{ at: 'Quelle' }], [{ at: 'Lake', note: 'x' }, { at: 'Lake', treat: true }]],
		['remove, then added again', ['water'], [{ at: 'Quelle' }], [{ at: 'Quelle', remove: true }, { at: 'Quelle', note: 'x' }]],
		['spot string vs {name}', ['access', 'transport'], [{ mode: 'bus', from: 'A', to: 'B' }], [{ mode: 'bus', from: 'A', to: { name: 'B' }, note: 'x' }]],
		['text case', ['access', 'transport'], [{ mode: 'bus', from: 'A', to: 'B' }], [{ mode: 'bus', from: 'a ', to: 'B', note: 'x' }]],
		['text map', ['access', 'parking'], [{ name: 'P1', at: 'Quelle' }], [{ name: { en: 'p1' }, size: 'small' }]],
		['inTable true vs absent', ['legs'], [{ to: 'Quelle' }, { to: 'Hut' }], [{ to: 'Hut', inTable: true, note: 'x' }]],
		['a profile span apart from the leg', ['legs'], [{ to: 'Hut' }], [{ from: 'Quelle', to: 'Hut', inTable: false, onProfile: true }]],
		['a string trimmed', ['sources'], [{ title: 'T', url: 'https://x.org' }], [{ title: 'T', url: ' https://x.org', note: 'x' }]]
	];
	for (const [name, path, sidecar, post] of cases) {
		assert.equal(shown(path, sidecar, post).length, siteList(path, sidecar, post).length, name);
	}
	// Several post entries over one row show merged, and edits go to the first.
	const [row] = shown(['water'], [{ at: 'Quelle' }], [{ at: 'Quelle', note: 'x' }, { at: 'quelle', treat: true }]);
	assert.deepEqual([row.post, row.postAt], [{ at: 'quelle', note: 'x', treat: true }, 0]);
	// The visit's own entry takes the ones after it with its key.
	const lake = shown(['water'], [{ at: 'Quelle' }], [{ at: 'Lake', note: 'x' }, { at: 'Lake', treat: true }]);
	assert.deepEqual(lake.map((r) => [r.post ?? null, r.postAt]), [[null, 2], [{ at: 'Lake', note: 'x', treat: true }, 0]]);
});

test('a new post entry carries the required fields, so the site reads it', () => {
	const cases: [string[], Record<string, unknown>, string][] = [
		[['sources'], { title: 'Guide', url: 'https://x.org', kind: 'guidebook' }, 'note'],
		[['signal'], { from: 'Quelle', to: 'Hut', quality: 'none' }, 'note'],
		[['navigation', 'spans'], { from: 'Quelle', to: 'Hut', marking: 'good' }, 'note'],
		[['access', 'borders'], { at: 'Hut', from: 'DE', to: 'AT' }, 'note']
	];
	for (const [path, entry, field] of cases) {
		const [row] = inheritedRows(list(path), [entry], undefined);
		const op = overrideOp(list(path), path, row, field, 'Checked');
		const merged = siteList(path, [entry], [op.value]);
		assert.equal(merged.length, 1, path.join('.'));
		assert.equal((merged[0] as { note: { en: string } }).note.en, 'Checked', path.join('.'));
	}
	// An entry using a shared record takes its required fields from the record: only `use` and the identity are copied.
	const transport = list(['access', 'transport']);
	const [bus] = inheritedRows(transport, [{ use: 'bus-1', mode: 'bus', from: 'A', to: 'B', line: '1' }], undefined);
	assert.deepEqual(Object.keys(overrideOp(transport, ['access', 'transport'], bus, 'note', 'x').value as object).sort(), ['from', 'mode', 'note', 'to', 'use']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertPost, convertSidecar, mergeRouteList } from './merge-route-list';

const DIR = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/markdown/', import.meta.url));

const RIDGE = { en: 'Ridge', de: 'Grat' };

/** A sidecar in the real files' layout: two-space indent, the old sections after the legs. */
function sidecar(legs: unknown[], sections: unknown[], difficulty: Record<string, unknown> = {}): string {
	return JSON.stringify({ name: 'Test', facts: { legs, difficulty: { ...difficulty, sections }, season: { best: [6, 7] } } }, null, 2) + '\n';
}

test('an exact section/leg pair merges', () => {
	const facts = {
		legs: [{ to: 'Hut', sac: 'T2' }, { to: { ref: 'node/1', name: 'Pass' }, sac: 'T4', note: RIDGE }, { to: 'Valley' }],
		difficulty: { sections: [{ to: 'Hut', sac: 'T2' }, { from: 'Hut', to: { name: 'Pass', ref: 'node/1' }, sac: 'T4', note: RIDGE }] }
	};
	const r = mergeRouteList(facts);
	assert.deepEqual([r.changed, r.merged, r.appended, r.into, r.apart], [true, 2, 0, [0, 1], []]);
	assert.deepEqual(facts, {
		legs: [{ to: 'Hut', sac: 'T2', onProfile: true }, { to: { ref: 'node/1', name: 'Pass' }, sac: 'T4', note: RIDGE, onProfile: true }, { to: 'Valley' }]
	});

	// In a sidecar the leg gains only its flag; the emptied difficulty goes.
	const raw = sidecar([{ to: 'Hut', sac: 'T2' }, { to: 'Valley', sac: 'T1' }], [{ from: 'Hut', to: 'Valley', sac: 'T1' }]);
	const { text } = convertSidecar(raw);
	assert.equal(text, raw
		.replace('"to": "Valley",\n        "sac": "T1"\n', '"to": "Valley",\n        "sac": "T1",\n        "onProfile": true\n')
		.replace(/,\n {4}"difficulty": \{[\s\S]*?\n {4}\}/, ''));
});

test('a conflicting pair stays apart and is reported', () => {
	const legs = [{ to: 'Hut', sac: 'T2' }, { to: 'Pass', sac: 'T3', note: { en: 'Steep' } }];
	const sections = [{ from: 'Hut', to: 'Pass', sac: 'T4', note: RIDGE }];
	const facts = { legs: structuredClone(legs), difficulty: { sac: 'T4', sections } };
	const r = mergeRouteList(facts);
	assert.deepEqual([r.merged, r.appended], [0, 1]);
	assert.deepEqual(facts, { legs: [...legs, { from: 'Hut', to: 'Pass', sac: 'T4', note: RIDGE, inTable: false, onProfile: true }], difficulty: { sac: 'T4' } });
	assert.deepEqual(r.apart, ['section 0 (Hut → Pass) and legs[1]: they differ in sac, note']);

	// A field on one side only would change the page: the leg's table row would show the section's note.
	const gain = mergeRouteList({ legs: [{ to: 'Pass', sac: 'T3' }], difficulty: { sections: [{ to: 'Pass', sac: 'T3', note: RIDGE }] } });
	assert.deepEqual([gain.merged, gain.apart], [0, ['section 0 (start/end → Pass) and legs[0]: the leg\'s table row would gain the section\'s note']]);
	// Nor into an optional leg, whose grade doesn't count.
	assert.equal(mergeRouteList({ legs: [{ to: 'Pass', sac: 'T3', optional: true }], difficulty: { sections: [{ to: 'Pass', sac: 'T3' }] } }).merged, 0);
	// A section on another stretch is no pair at all.
	assert.deepEqual(mergeRouteList({ legs: [{ to: 'Pass' }], difficulty: { sections: [{ from: 'Hut', to: 'Pass' }] } }).apart, []);
});

test('merging keeps the order of the sections list', () => {
	const legs = () => [{ to: 'A', sac: 'T1' }, { to: 'B', sac: 'T2' }, { to: 'C', sac: 'T3' }];
	const profile = (facts: { legs?: Record<string, unknown>[] }) => facts.legs!.filter((l) => l.onProfile).map((l) => `${l.from ?? ''}→${l.to ?? ''}`);

	// The second section matches an earlier leg than the first: merging it would put it first.
	const back = { legs: legs(), difficulty: { sections: [{ from: 'B', to: 'C', sac: 'T3' }, { to: 'A', sac: 'T1' }] } };
	const r = mergeRouteList(back);
	assert.deepEqual([r.into, r.apart], [[2, -1], ['section 1 (start/end → A) and legs[0]: merging would move it ahead of an earlier profile entry']]);
	assert.deepEqual(profile(back), ['→C', '→A']);

	// Once a section is appended, the later ones follow it to the end.
	const after = { legs: legs(), difficulty: { sections: [{ from: 'X', to: 'Y', sac: 'T2' }, { from: 'B', to: 'C', sac: 'T3' }] } };
	assert.deepEqual(mergeRouteList(after).into, [-1, -1]);
	assert.deepEqual(profile(after), ['X→Y', 'B→C']);

	// In order, both merge.
	const ok = { legs: legs(), difficulty: { sections: [{ to: 'A', sac: 'T1' }, { from: 'B', to: 'C', sac: 'T3' }] } };
	assert.deepEqual(mergeRouteList(ok).into, [0, 2]);
	assert.deepEqual(profile(ok), ['→A', '→C']);

	// A merge that would change which of two equal grades is the computed one stays apart.
	const tie = { legs: [{ to: 'A', sac: 'T1-T3' }, { to: 'B', sac: 'T3' }], difficulty: { sections: [{ from: 'A', to: 'B', sac: 'T3' }] } };
	assert.deepEqual(mergeRouteList(tie).into, [-1]);
});

test('the route-list pass is a no-op on converted data', () => {
	// Appended sections keep their own text, number spellings included, and a second pass changes nothing.
	const raw = sidecar([{ to: 'Hut', sac: 'T2' }], [{ from: { lat: 47.5, lon: 11.2, demEle: 784.5 }, sac: 'T3' }], { fitness: 2 }).replace('784.5', '784.0');
	const once = convertSidecar(raw);
	assert.equal(once.result.appended, 1);
	assert.match(once.text, /"demEle": 784\.0\n/);
	assert.match(once.text, /"sac": "T3",\n {8}"inTable": false,\n {8}"onProfile": true\n {6}\}\n {4}\],\n {4}"difficulty": \{\n {6}"fitness": 2\n {4}\},/);
	const twice = convertSidecar(once.text);
	assert.deepEqual([twice.text, twice.result.changed], [once.text, false]);

	// Every real file: converting the converted text changes nothing.
	for (const name of readdirSync(DIR)) {
		const convert = name.endsWith('.hike.json') ? convertSidecar : name.endsWith('.md') ? convertPost : null;
		if (!convert) continue;
		const first = convert(readFileSync(join(DIR, name), 'utf8')).text;
		assert.equal(convert(first).text, first, name);
	}

	// A post, through the front-matter writer: the comment stays, the section joins the legs.
	const post = '---\ntitle: T\nfacts:\n  # the route\n  legs:\n    - {to: Hut, sac: T2}\n  difficulty:\n    sections:\n      - {to: Hut, sac: T2}\n      - {from: Hut, sac: T3}\n---\nBody\n';
	const p = convertPost(post);
	assert.equal(p.text, '---\ntitle: T\nfacts:\n  # the route\n  legs:\n    - {to: Hut, sac: T2, onProfile: true}\n    - {from: Hut, sac: T3, inTable: false, onProfile: true}\n---\nBody\n');
	assert.equal(convertPost(p.text).text, p.text);
});

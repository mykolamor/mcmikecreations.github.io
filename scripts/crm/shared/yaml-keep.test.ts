import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { setYamlKeeping } from './yaml-keep';

const edit = (raw: string, path: (string | number)[], value: unknown): string => {
	const { doc, body } = readFrontmatterDoc(raw);
	setYamlKeeping(doc, path, value);
	return writeFrontmatterDoc(doc, body);
};

const RAW = `---
facts:
  temp: {min: 1.0, max: 9} # flow, as typed
  legs:
    # the climb
    - to: A
      sac: T1
    - {to: 'B'}
---
`;

test('an equal value keeps every byte', () => {
	assert.equal(edit(RAW, ['facts'], { temp: { min: 1, max: 9 }, legs: [{ to: 'A', sac: 'T1' }, { to: 'B' }] }), RAW);
});

test('a map is edited per key and keeps its style', () => {
	assert.equal(edit(RAW, ['facts', 'temp'], { min: 1, max: 12 }), RAW.replace('max: 9}', 'max: 12}'));
	assert.equal(edit(RAW, ['facts', 'legs', 0], { to: 'A', sac: 'T2', note: 'x' }), RAW.replace('sac: T1\n', 'sac: T2\n      note: x\n'));
	assert.equal(edit(RAW, ['facts', 'legs', 0], { to: 'A' }), RAW.replace('      sac: T1\n', ''));
});

test('list items equal to an old one keep its node, each used once', () => {
	const two = edit(RAW, ['facts', 'legs'], [{ to: 'B' }, { to: 'A', sac: 'T1' }, { to: 'B' }]);
	// A comment above the first item is the list's (yaml's model), so it stays on top.
	assert.equal(two, RAW.replace("    - to: A\n      sac: T1\n    - {to: 'B'}\n", "    - {to: 'B'}\n    - to: A\n      sac: T1\n    - to: B\n"));
	// One above a later item moves with it.
	const later = '---\nlegs:\n  - to: A\n  # the descent\n  - to: B # last\n---\n';
	assert.equal(edit(later, ['legs'], [{ to: 'B' }, { to: 'A' }]), '---\nlegs:\n  # the descent\n  - to: B # last\n  - to: A\n---\n');
});

test('new maps are block style, new lists of scalars flow style, a new top-level key goes before images', () => {
	const raw = '---\ntitle: T\nimages:\n  x.jpg: {w: 1}\n---\n';
	assert.equal(
		edit(raw, ['facts', 'plan', 'gear'], [{ item: 'rope', when: ['winter'] }]),
		'---\ntitle: T\nfacts:\n  plan:\n    gear:\n      - item: rope\n        when: [winter]\nimages:\n  x.jpg: {w: 1}\n---\n'
	);
	assert.equal(edit('---\ntitle: T\n---\n', ['facts', 'season', 'best'], [6, 7]), '---\ntitle: T\nfacts:\n  season:\n    best: [6, 7]\n---\n');
	assert.throws(() => edit(RAW, ['facts', 'legs', 5], { to: 'C' }), /No item 5/);
});

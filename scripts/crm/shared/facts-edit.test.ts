import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findNodeAtLocation, parse, parseTree } from 'jsonc-parser';
import { applyFactsEdit, type FactsOp } from './facts-edit';
import { applyOps } from './ops';
import { clientDoc, docVersion, loadDoc, saveOps, sidecarPath, type HikeDoc } from '../server/doc';
import { ApiError } from '../server/errors';
import { makeTempRepo } from '../server/test-repo';
import { editSidecar } from '../server/sidecar-file';

const REAL_ROOT = path.resolve(__dirname, '../../..');
const hike = (path: FactsOp['path'], rest: Partial<FactsOp>): FactsOp => ({ kind: 'facts', scope: 'hike', path, ...rest });
const post = (path: FactsOp['path'], rest: Partial<FactsOp>): FactsOp => ({ kind: 'facts', scope: 'post', path, ...rest });
const refused = (re: RegExp) => (e: unknown) => e instanceof ApiError && e.status === 400 && re.test(e.message);
const mk = (sidecarRaw: string, postRaw: string | null = null): HikeDoc => ({
	slug: 's',
	date: postRaw === null ? null : '2024-01-01',
	sidecarRaw,
	postRaw,
	version: docVersion(sidecarRaw, postRaw)
});

test('a sidecar facts edit changes only that value\'s bytes', () => {
	const root = makeTempRepo();
	try {
		const file = sidecarPath(root, 'mahnkopf');
		// The first leg without a note of its own, whatever the real sidecar has there today.
		writeFileSync(file, editSidecar(readFileSync(file, 'utf8'), [{ path: ['facts', 'legs', 0, 'note'], value: undefined }]));
		const raw = readFileSync(file, 'utf8');
		const doc = loadDoc(root, 'mahnkopf', null);
		const r = saveOps(root, 'mahnkopf', null, doc.version, [hike(['legs', 0, 'note'], { value: { en: 'Gravel first.', de: '' } })]);
		assert.equal(r.ok, true);
		// The note goes after the first leg's last member: one new line, and that member gains its comma.
		const last = findNodeAtLocation(parseTree(raw)!, ['facts', 'legs', 0])!.children!.at(-1)!;
		const end = last.offset + last.length;
		assert.equal(readFileSync(file, 'utf8'), raw.slice(0, end) + ',\n        "note": {\n          "en": "Gravel first."\n        }' + raw.slice(end));
		assert.deepEqual((r.doc.facts.hike as any).legs[0].note, { en: 'Gravel first.' });
		assert.equal(r.doc.facts.post, null);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const POST = `---
title: T
# a comment on its own line
tags: [a, b]
facts:
  # sources stay as typed
  sources:
    - {title: Komoot, url: 'https://komoot.com/x', kind: mirror}
  season:
    best: [6, 7] # summer
images:
  x.jpg: {w: 1, h: 2}
---
Body
`;

test('a post facts edit keeps comments and other keys', () => {
	let out = applyFactsEdit(POST, 'post', post(['season', 'possible'], { value: [5, 8] }));
	out = applyFactsEdit(out, 'post', post(['difficulty', 'sac'], { value: 'T3' }));
	out = applyFactsEdit(out, 'post', post(['legs'], { value: [{ to: 'Hut', terrain: ['path', 'meadow'] }] }));
	assert.equal(
		out,
		POST.replace('    best: [6, 7] # summer\n', '    best: [6, 7] # summer\n    possible: [5, 8]\n').replace(
			'images:',
			'  difficulty:\n    sac: T3\n  legs:\n    - to: Hut\n      terrain: [path, meadow]\nimages:'
		)
	);
	// Without facts, the key goes before `images:`.
	const bare = '---\ntitle: T\nimages:\n  x.jpg: {w: 1}\n---\nB\n';
	assert.equal(applyFactsEdit(bare, 'post', post(['drones'], { value: { en: 'No.' } })), '---\ntitle: T\nfacts:\n  drones:\n    en: No.\nimages:\n  x.jpg: {w: 1}\n---\nB\n');
});

test('a text with only English is written as {en}, and a translation adds to the map', () => {
	const side = '{\n  "facts": {\n    "drones": "No.",\n    "summary": {\n      "en": "S",\n      "de": "Ś"\n    }\n  }\n}\n';
	const de = applyFactsEdit(side, 'sidecar', hike(['drones'], { value: { en: 'No.', de: 'Nein.' } }));
	assert.deepEqual(parse(de).facts.drones, { en: 'No.', de: 'Nein.' });
	assert.equal(de, side.replace('"drones": "No."', '"drones": {\n      "en": "No.",\n      "de": "Nein."\n    }'));
	// Clearing the German leaves {en}: only that key goes.
	assert.equal(applyFactsEdit(side, 'sidecar', hike(['summary'], { value: { en: 'S', de: '' } })), side.replace(',\n      "de": "Ś"', ''));
	// Editing the English keeps every other language, untouched bytes included.
	const uk = side.replace('"de": "Ś"', '"de": "Ś",\n      "uk": "С"');
	assert.equal(applyFactsEdit(uk, 'sidecar', hike(['summary'], { value: { en: 'T', de: 'Ś' } })), uk.replace('"en": "S"', '"en": "T"'));
	// The same in a post.
	const p = applyFactsEdit(POST, 'post', post(['season', 'note'], { value: { en: 'Dry', de: 'Trocken' } }));
	assert.match(p, /\n {4}note:\n {6}en: Dry\n {6}de: Trocken\n/);
	assert.equal(applyFactsEdit(p, 'post', post(['season', 'note'], { value: { en: 'Dry', de: '' } })), POST.replace('# summer\n', '# summer\n    note:\n      en: Dry\n'));
});

test('clearing English with a translation present is refused', () => {
	const side = '{\n  "facts": {\n    "summary": {"en": "S", "de": "Ś"}\n  }\n}\n';
	const msg = /^facts\.summary: the English text is required while the field has a translation \(de\)$/;
	assert.throws(() => applyFactsEdit(side, 'sidecar', hike(['summary'], { value: { en: '', de: 'Ś' } })), refused(msg));
	assert.throws(() => applyFactsEdit(side, 'sidecar', hike(['summary'], { value: { en: ' ' } })), refused(msg));
	assert.throws(() => applyFactsEdit(POST, 'post', post(['drones'], { value: { en: '', de: 'Nein' } })), refused(/translation \(de\)/));
	// Clearing every language removes the text.
	assert.equal(applyFactsEdit(side, 'sidecar', hike(['summary'], { value: { en: '', de: '' } })), '{\n}\n');
});

test('a post null is written as null, and a hike null is refused', () => {
	assert.equal(applyFactsEdit(POST, 'post', post(['season', 'best'], { value: null })), POST.replace('best: [6, 7] # summer', 'best: null # summer'));
	assert.equal(applyFactsEdit(POST, 'post', post(['route', 'shade'], { value: null })), POST.replace('images:', '  route:\n    shade: null\nimages:'));
	const side = '{\n  "facts": {\n    "drones": "No."\n  }\n}\n';
	assert.throws(() => applyOps(mk(side), [hike(['drones'], { value: null })]), refused(/null/));
	// A post op on a hike without a post, and a bad scope, are refused too.
	assert.throws(() => applyOps(mk(side), [post(['drones'], { value: 'x' })]), refused(/No post/));
	assert.throws(() => applyOps(mk(side, POST), [{ ...hike(['drones'], { value: 'x' }), scope: 'both' as 'hike' }]), refused(/scope/));
});

test('removing the last entry removes the list, and an empty facts goes', () => {
	const side = readFileSync(sidecarPath(REAL_ROOT, 'mahnkopf'), 'utf8');
	const optional = parse(side).facts.route.optional;
	assert.equal(optional.length, 1);
	const out = applyFactsEdit(side, 'sidecar', hike(['route', 'optional', 0], { remove: true }));
	assert.equal(parse(out).facts.route.optional, undefined);
	const want = parse(side);
	delete want.facts.route.optional;
	assert.deepEqual(parse(out), want);
	assert.doesNotMatch(out, /"optional": \[/);
	// Only the removed key's lines are gone.
	const at = side.indexOf('"optional": [');
	assert.equal(out, side.slice(0, side.lastIndexOf(',', at)) + side.slice(side.indexOf(']', side.indexOf('"note"', at)) + 1));

	// An item of a one-line list leaves it on one line; an entry of a list of maps takes only its own lines.
	assert.equal(applyFactsEdit(side, 'sidecar', hike(['season', 'best', 2], { remove: true })), side.replace('"best": [5, 6, 7, 8, 9]', '"best": [5, 6, 8, 9]'));
	const tree = parseTree(side)!;
	const legs = findNodeAtLocation(tree, ['facts', 'legs', 0])!.offset;
	const second = findNodeAtLocation(tree, ['facts', 'legs', 1])!.offset;
	assert.equal(applyFactsEdit(side, 'sidecar', hike(['legs', 0], { remove: true })), side.slice(0, legs) + side.slice(second));

	// The last key of the last map, and then `facts` itself.
	const one = '{\n  "name": "N",\n  "facts": {\n    "season": {\n      "best": [6]\n    }\n  }\n}\n';
	assert.equal(applyFactsEdit(one, 'sidecar', hike(['season', 'best', 0], { remove: true })), '{\n  "name": "N"\n}\n');
	let p = applyFactsEdit(POST, 'post', post(['sources', 0], { remove: true }));
	assert.doesNotMatch(p, /sources:/);
	p = applyFactsEdit(p, 'post', post(['season', 'best'], { remove: true }));
	assert.equal(p, '---\ntitle: T\n# a comment on its own line\ntags: [a, b]\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nBody\n');
	// Removing what is not there changes nothing.
	assert.equal(applyFactsEdit(POST, 'post', post(['hazards', 3], { remove: true })), POST);
	assert.equal(applyFactsEdit(one, 'sidecar', hike(['water'], { remove: true })), one);
});

test('a reordered list keeps each moved entry\'s bytes', () => {
	const side = readFileSync(sidecarPath(REAL_ROOT, 'mahnkopf'), 'utf8');
	const legs = parse(side).facts.legs as unknown[];
	const moved = [...legs].reverse();
	const out = applyFactsEdit(side, 'sidecar', hike(['legs'], { value: moved }));
	assert.deepEqual(parse(out).facts.legs, moved);
	// Every line of the file is still there (only the commas between the moved entries may move).
	const lines = (s: string) => s.split('\n').map((l) => l.replace(/,$/, '')).sort();
	assert.deepEqual(lines(out), lines(side));

	const yaml = `---
facts:
  legs:
    - to: A # first
      sac: T1
    - {to: B, sac: 'T2'}
    - to: C
---
`;
	const back = applyFactsEdit(yaml, 'post', post(['legs'], { value: [{ to: 'C' }, { to: 'A', sac: 'T1' }, { to: 'B', sac: 'T2' }] }));
	assert.equal(back, "---\nfacts:\n  legs:\n    - to: C\n    - to: A # first\n      sac: T1\n    - {to: B, sac: 'T2'}\n---\n");
	// An appended entry is a new block map; the others keep their nodes.
	const more = applyFactsEdit(yaml, 'post', post(['legs', 3], { value: { to: 'D', terrain: ['path'] } }));
	assert.equal(more, yaml.replace('    - to: C\n', '    - to: C\n    - to: D\n      terrain: [path]\n'));
});

test('the client doc carries the raw facts of each file', () => {
	const side = '{\n  "facts": {"drones": {"en": "No", "de": "Nein"}}\n}\n';
	const d = clientDoc(mk(side, '---\ntitle: T\nfacts:\n  checked: 2026-10-01\n  route: {shade: null}\n---\n'));
	assert.deepEqual(d.facts, { hike: { drones: { en: 'No', de: 'Nein' } }, post: { checked: '2026-10-01', route: { shade: null } } });
	assert.deepEqual(clientDoc(mk('{}\n')).facts, { hike: null, post: null });
	assert.deepEqual(clientDoc(mk('{}\n', '---\ntitle: T\n---\n')).facts, { hike: null, post: null });
});

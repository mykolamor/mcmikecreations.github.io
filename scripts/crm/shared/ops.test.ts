import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOps, applyPlaceOps, type FieldOp } from './ops';
import { clientDoc, docVersion, readField, type HikeDoc } from '../server/doc';
import { FIELDS } from './fields';
import { placeClientDoc } from '../server/place-doc';
import { repoPaths } from '../server/paths';
import { ApiError } from '../server/errors';
import { FrontmatterError } from '../lib/frontmatter';

const f = (id: string) => FIELDS.find((x) => x.id === id)!;
const POST = '---\ntitle: T\ndescription: D\ntags:\n  - a\n  - b\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nBody\n';
const SIDE = '{\n  "name": "N",\n  "description": "D"\n}\n';
const mk = (postRaw = POST): HikeDoc => ({ slug: 's', date: '2024-01-01', sidecarRaw: SIDE, postRaw, version: docVersion(SIDE, postRaw) });

test('empty string removes a post key', () => {
	const out = applyOps(mk(), [{ field: 'post.description', value: '' }]);
	assert.equal(out.postRaw, POST.replace('description: D\n', ''));
});

test('[] removes chips key', () => {
	const out = applyOps(mk(), [{ field: 'post.tags', value: [] }]);
	assert.equal(out.postRaw, POST.replace('tags:\n  - a\n  - b\n', ''));
});

test('chips keep order and drop blanks/duplicates (case-insensitive)', () => {
	const out = applyOps(mk(), [{ field: 'post.tags', value: ['Z', ' ', 'a', 'z', 'A', 'm'] }]);
	assert.deepEqual(readField(out, f('post.tags')), ['Z', 'a', 'm']);
});

test("setting a post key that doesn't exist inserts it before images:", () => {
	const out = applyOps(mk(), [{ field: 'post.people', value: ['Ann'] }]);
	assert.equal(out.postRaw, POST.replace('images:', 'people:\n  - Ann\nimages:'));
	const out2 = applyOps(mk('---\ntitle: T\n---\nB\n'), [{ field: 'post.updated', value: '2025-01-02' }]);
	assert.equal(out2.postRaw, '---\ntitle: T\nupdated: 2025-01-02\n---\nB\n');
});

test('sidecar ops are minimal and bump the version', () => {
	const out = applyOps(mk(), [{ field: 'sidecar.name', value: 'M' }]);
	assert.equal(out.sidecarRaw, SIDE.replace('"N"', '{\n    "en": "M"\n  }'));
	assert.notEqual(out.version, mk().version);
	assert.equal(out.postRaw, POST);
});

const SIDE_DE = '{\n  "name": {"en": "N", "de": "Ň"},\n  "description": {\n    "en": "D",\n    "de": "Ď"\n  }\n}\n';
const mkDe = (sidecarRaw = SIDE_DE): HikeDoc => ({ slug: 's', date: null, sidecarRaw, postRaw: null, version: docVersion(sidecarRaw, null) });

test('editing the English name keeps the German', () => {
	assert.equal(clientDoc(mkDe()).fields['sidecar.name'], 'N');
	assert.equal(clientDoc(mkDe()).fields['sidecar.description'], 'D');
	const out = applyOps(mkDe(), [
		{ field: 'sidecar.name', value: 'M' },
		{ field: 'sidecar.description', value: 'E' }
	]);
	assert.equal(out.sidecarRaw, SIDE_DE.replace('"N"', '"M"').replace('"D"', '"E"'));
	assert.equal(clientDoc(out).fields['sidecar.name'], 'M');
	// Clearing the English would leave the German without its source.
	assert.throws(() => applyOps(mkDe(), [{ field: 'sidecar.name', value: ' ' }]), (e) => e instanceof ApiError && e.status === 400 && /translation/.test(e.message));
});

test('an English-only name is written as {en}', () => {
	assert.equal(applyOps(mk(), [{ field: 'sidecar.name', value: 'M' }]).sidecarRaw, SIDE.replace('"N"', '{\n    "en": "M"\n  }'));
	// `{en}` alone shows as the English text, and an edit changes only its `en`.
	const enOnly = mkDe('{\n  "name": {"en": "N"}\n}\n');
	assert.equal(clientDoc(enOnly).fields['sidecar.name'], 'N');
	const out = applyOps(enOnly, [{ field: 'sidecar.name', value: 'M' }]);
	assert.equal(out.sidecarRaw, '{\n  "name": {"en": "M"}\n}\n');
});

test('a German name is written into the name map and keeps the English', () => {
	const out = applyOps(mk(), [{ field: 'sidecar.name', lang: 'de', value: 'Ň' }]);
	assert.equal(out.sidecarRaw, SIDE.replace('"name": "N"', '"name": {\n    "en": "N",\n    "de": "Ň"\n  }'));
	assert.deepEqual(clientDoc(out).texts['sidecar.name'], { en: 'N', de: 'Ň' });
	assert.equal(clientDoc(out).fields['sidecar.name'], 'N');
	assert.equal(applyOps(mkDe(), [{ field: 'sidecar.name', lang: 'de', value: 'Ž' }]).sidecarRaw, SIDE_DE.replace('Ň', 'Ž'));
});

test('a name with only English is written as {en}', () => {
	assert.deepEqual(clientDoc(mk()).texts['sidecar.name'], { en: 'N' });
	// A German name that was never typed (or is blank) writes nothing.
	assert.equal(applyOps(mk(), [{ field: 'sidecar.name', lang: 'de', value: '' }]).sidecarRaw, SIDE);
	assert.equal(applyOps(mk(), [{ field: 'sidecar.name', value: 'M' }]).sidecarRaw, SIDE.replace('"N"', '{\n    "en": "M"\n  }'));
});

test('clearing the German leaves {en} in a two-language name', () => {
	const out = applyOps(mkDe(), [{ field: 'sidecar.name', lang: 'de', value: '' }]);
	assert.equal(out.sidecarRaw, SIDE_DE.replace('{"en": "N", "de": "Ň"}', '{\n    "en": "N"\n  }'));
	// With another (unlisted) language left, only the cleared key goes.
	const three = mkDe('{\n  "name": {"en": "N", "de": "Ň", "uk": "Н"}\n}\n');
	assert.deepEqual(JSON.parse(applyOps(three, [{ field: 'sidecar.name', lang: 'de', value: '' }]).sidecarRaw), { name: { en: 'N', uk: 'Н' } });
});

test('a lang op on an untranslated field is refused', () => {
	const refused = (op: FieldOp) => assert.throws(() => applyOps(mk(), [op]), (e) => e instanceof ApiError && e.status === 400);
	refused({ field: 'post.title', lang: 'de', value: 'T' });
	refused({ field: 'sidecar.name', lang: 'en' as never, value: 'T' });
	refused({ field: 'sidecar.name', lang: 'xx' as never, value: 'T' });
	// A name without English can't take a translation.
	assert.throws(() => applyOps(mkDe('{\n  "description": "D"\n}\n'), [{ field: 'sidecar.name', lang: 'de', value: 'T' }]), (e) => e instanceof ApiError && e.status === 400);
});

test('removing the last front-matter key writes no {}', () => {
	const a = applyOps(mk('---\ntitle: T\n---\nB\n'), [{ field: 'post.title', value: '' }]);
	assert.equal(a.postRaw, '---\n---\nB\n');
	const b = applyOps(mk('---\ntitle: T\n# c\n---\nB\n'), [{ field: 'post.title', value: '' }]);
	assert.equal(b.postRaw, '---\n# c\n---\nB\n');
});

const SIDE_MAP =
	'{\n  "name": "N",\n  "origin": {\n    "lat": 47.4095595,\n    "lon": 10.9135899\n  },\n  "height": 512,\n  "checkpoints": [\n    [10.9, 47.4],\n    [10.91, 47.41],\n    [10.92, 47.42]\n  ],\n  "nodes": ["node/1", "way/2"]\n}\n';
const mkMap = (postRaw = POST): HikeDoc => ({ slug: 's', date: '2024-01-01', sidecarRaw: SIDE_MAP, postRaw, version: docVersion(SIDE_MAP, postRaw) });

test('override on copies the hike value into the post', () => {
	const out = applyOps(mkMap(), [
		{ field: 'map.origin', scope: 'post', value: { lat: 47.4095595, lon: 10.9135899 } },
		{ field: 'map.height', scope: 'post', value: 512 },
		{ field: 'map.checkpoints', scope: 'post', value: [[10.9, 47.4], [10.91, 47.41]] }
	]);
	assert.equal(out.sidecarRaw, SIDE_MAP);
	assert.equal(
		out.postRaw,
		POST.replace('images:', 'origin: {lat: 47.4095595, lon: 10.9135899}\nheight: 512\ncheckpoints:\n  - [10.9, 47.4]\n  - [10.91, 47.41]\nimages:')
	);
	assert.deepEqual(readField(out, f('map.height'), 'post'), 512);
	assert.deepEqual(readField(out, f('map.origin'), 'post'), { lat: 47.4095595, lon: 10.9135899 });
});

test('override off removes the post key', () => {
	const on = applyOps(mkMap(), [{ field: 'map.height', scope: 'post', value: 600 }]);
	const off = applyOps(on, [{ field: 'map.height', scope: 'post', value: null }]);
	assert.equal(off.postRaw, POST);
	assert.equal(off.sidecarRaw, SIDE_MAP);
});

test('hike scope edits only the sidecar lines', () => {
	const out = applyOps(mkMap(), [
		{ field: 'map.origin', value: { lat: 47.5, lon: 10.9135899 } },
		{ field: 'map.nodes', value: ['node/1', 'way/2', 'relation/3'] },
		{ field: 'map.checkpoints', value: [[10.92, 47.42], [10.91, 47.41], [10.9, 47.4]] }
	]);
	assert.equal(
		out.sidecarRaw,
		SIDE_MAP.replace('47.4095595', '47.5')
			.replace('["node/1", "way/2"]', '["node/1", "way/2", "relation/3"]')
			.replace('[10.9, 47.4],\n    [10.91, 47.41],\n    [10.92, 47.42]', '[10.92, 47.42],\n    [10.91, 47.41],\n    [10.9, 47.4]')
	);
	assert.equal(out.postRaw, POST);
});

test('invalid map values are 400', () => {
	const bad = (op: FieldOp) => assert.throws(() => applyOps(mkMap(), [op]), (e: any) => e.status === 400);
	bad({ field: 'map.height', value: 64 });
	bad({ field: 'map.height', value: 300.5 });
	bad({ field: 'map.height', value: 4000 });
	bad({ field: 'map.origin', value: { lat: 91, lon: 0 } });
	bad({ field: 'map.origin', value: { lat: 0, lon: -181 } });
	bad({ field: 'map.checkpoints', value: [[1, NaN]] });
	bad({ field: 'map.checkpoints', value: [[1]] });
	bad({ field: 'map.nodes', value: ['node/1', 'node/1'] });
	bad({ field: 'map.nodes', value: ['pt/1'] });
	bad({ field: 'map.nodes', scope: 'post', value: ['node/1'] });
	bad({ field: 'sidecar.name', scope: 'post', value: 'x' });
});

test('client doc gives map fields as { hike, post }', () => {
	const doc = applyOps(mkMap(), [{ field: 'map.height', scope: 'post', value: 600 }]);
	const c = clientDoc(doc).fields;
	assert.deepEqual(c['map.height'], { hike: 512, post: 600 });
	assert.deepEqual(c['map.nodes'], { hike: ['node/1', 'way/2'] });
	assert.deepEqual(c['map.origin'], { hike: { lat: 47.4095595, lon: 10.9135899 } });
});

test('replacing an existing post origin/checkpoints keeps style and unmoved pairs', () => {
	const post = '---\ntitle: T\norigin: {lat: 47.70, lon: 11.8}\ncheckpoints:\n  - [10.90, 47.4]\n  - [10.91, 47.41]\nimages:\n  x.jpg: {w: 1, h: 2}\n---\nB\n';
	const out = applyOps(mkMap(post), [
		{ field: 'map.origin', scope: 'post', value: { lat: 48, lon: 11.8 } },
		{ field: 'map.checkpoints', scope: 'post', value: [[10.91, 47.41], [10.90, 47.4], [1, 2]] }
	]);
	assert.equal(out.postRaw, post.replace('lat: 47.70', 'lat: 48').replace('  - [10.90, 47.4]\n  - [10.91, 47.41]', '  - [10.91, 47.41]\n  - [10.90, 47.4]\n  - [1, 2]'));
});

test('unknown scope is 400', () => {
	assert.throws(() => applyOps(mkMap(), [{ field: 'map.height', scope: 'x' as never, value: 512 }]), (e: any) => e.status === 400);
});

test('body op replaces only the bytes after the front matter', () => {
	const out = applyOps(mk(), [{ kind: 'body', text: 'New\n\nText' }]);
	assert.equal(out.postRaw, POST.replace('Body\n', 'New\n\nText'));
	assert.equal(out.sidecarRaw, SIDE);
	assert.notEqual(out.version, mk().version);
	const crlf = applyOps(mk(), [{ kind: 'body', text: 'a\r\nb' }]);
	assert.equal(crlf.postRaw, POST.replace('Body\n', 'a\r\nb'));
	assert.equal(applyOps(mk('---\ntitle: T\n---'), [{ kind: 'body', text: 'x\n' }]).postRaw, '---\ntitle: T\n---\nx\n');
	assert.equal(applyOps(mk('---\ntitle: T\n---'), [{ kind: 'body', text: '' }]).postRaw, '---\ntitle: T\n---');
	assert.equal(applyPlaceOps('---\ntitle: P\n---\nOld\n', [{ kind: 'body', text: '' }]), '---\ntitle: P\n---\n');
	const hike: HikeDoc = { ...mk(), date: null, postRaw: null };
	assert.throws(() => applyOps(hike, [{ kind: 'body', text: 'x' }]), (e) => e instanceof ApiError && e.status === 400);
});

test('a body op on a doc whose front matter changed keeps the new front matter', () => {
	// The editor loaded POST; meanwhile a photo add stamped `updated:`. The body save is applied to the current raw.
	const stamped = POST.replace('images:', 'updated: 2026-10-29\nimages:');
	const out = applyOps(mk(stamped), [{ kind: 'body', text: 'Typed\n' }]);
	assert.equal(out.postRaw, stamped.replace('Body\n', 'Typed\n'));
	const both = applyOps(mk(), [{ field: 'post.updated', value: '2026-10-29' }, { kind: 'body', text: 'Typed\n' }, { field: 'post.title', value: 'U' }]);
	assert.equal(both.postRaw, stamped.replace('title: T', 'title: U').replace('Body\n', 'Typed\n'));
});

test('body op with the current text is a byte no-op for every real post and place doc', () => {
	const p = repoPaths(join(__dirname, '../../..'));
	let posts = 0;
	for (const f of readdirSync(p.markdown).filter((f) => f.endsWith('.md'))) {
		const raw = readFileSync(join(p.markdown, f), 'utf8');
		const doc: HikeDoc = { slug: 's', date: '2024-01-01', sidecarRaw: SIDE, postRaw: raw, version: docVersion(SIDE, raw) };
		const body = clientDoc(doc).body;
		assert.equal(typeof body, 'string', f);
		assert.equal(applyOps(doc, [{ kind: 'body', text: body! }]).postRaw, raw, f);
		posts++;
	}
	let places = 0;
	for (const f of readdirSync(p.places).filter((f) => f.endsWith('.md'))) {
		const raw = readFileSync(join(p.places, f), 'utf8');
		const { body } = placeClientDoc({ slug: f.slice(0, -3), raw, version: 'v' });
		assert.equal(applyPlaceOps(raw, [{ kind: 'body', text: body }]), raw, f);
		places++;
	}
	assert.ok(posts > 10 && places > 0, `${posts} posts, ${places} places`);
});

test('a --- rule inside the body stays body', () => {
	const raw = '---\ntitle: T\n---\nA\n\n---\n\nB\n';
	assert.equal(clientDoc(mk(raw)).body, 'A\n\n---\n\nB\n');
	assert.equal(applyOps(mk(raw), [{ kind: 'body', text: 'A\n\n---\n\nC\n' }]).postRaw, '---\ntitle: T\n---\nA\n\n---\n\nC\n');
	assert.equal(placeClientDoc({ slug: 'p', raw, version: 'v' }).body, 'A\n\n---\n\nB\n');
});

test('a body op on a raw without front matter is refused', () => {
	const is400 = (e: unknown) => e instanceof ApiError && e.status === 400;
	assert.throws(() => applyOps(mk('Just text\n'), [{ kind: 'body', text: 'x' }]), is400);
	assert.throws(() => applyPlaceOps('', [{ kind: 'body', text: 'x' }]), is400);
});

test('a CRLF or unclosed front matter fence is a FrontmatterError, not a silent split', () => {
	for (const raw of ['---\r\ntitle: T\r\n---\r\nB\r\n', '---\ntitle: T\nBody without a closing fence\n'])
		assert.throws(() => applyOps(mk(raw), [{ kind: 'body', text: 'x' }]), (e) => e instanceof FrontmatterError, JSON.stringify(raw));
});

test('a whitespace-only value of a required field counts as empty', () => {
	const raw = '---\ntitle: Hut\ndescription: D\n---\n';
	for (const field of ['place.title', 'place.description'])
		assert.throws(() => applyPlaceOps(raw, [{ field, value: ' \t ' }]), (e) => e instanceof ApiError && e.status === 400 && /required/.test(e.message));
	// an optional text field keeps today's rule: only '' removes it
	assert.equal(applyOps(mk(), [{ field: 'post.description', value: ' ' }]).postRaw, POST.replace('description: D', 'description: " "'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyMirrorRows, mirrorRows } from './mirrors';
import { applyOps } from './ops';
import { docVersion, type HikeDoc } from '../server/doc';
import { readFrontmatterDoc } from '../lib/frontmatter';

const KOMOOT = { title: 'Komoot', url: 'https://www.komoot.com/tour/1', kind: 'mirror' };
const STRAVA = { title: 'Strava', url: 'https://www.strava.com/activities/2', kind: 'mirror' };
const VIDEO = { title: { en: 'Clips' }, url: 'https://youtu.be/x', kind: 'video' };

test('existing Komoot+Strava rows round-trip with an empty AllTrails row', () => {
	const rows = mirrorRows([KOMOOT, STRAVA]);
	assert.deepEqual(rows, [
		{ title: 'Komoot', url: KOMOOT.url, key: 0 },
		{ title: 'Strava', url: STRAVA.url, key: 1 },
		{ title: 'AllTrails', url: '' }
	]);
	assert.deepEqual(applyMirrorRows([KOMOOT, STRAVA], rows), [KOMOOT, STRAVA]);
});

test('clearing a URL removes that entry', () => {
	const rows = mirrorRows([KOMOOT, STRAVA]);
	rows[0].url = '';
	assert.deepEqual(applyMirrorRows([KOMOOT, STRAVA], rows), [STRAVA]);
});

test('a video source is kept untouched', () => {
	const out = applyMirrorRows([KOMOOT, VIDEO], [{ title: 'Komoot', url: '' }]);
	assert.deepEqual(out, [VIDEO]);
	assert.equal(out[0], VIDEO);
});

test('adding a custom mirror row "Bergfex" appends it', () => {
	const rows = [...mirrorRows([KOMOOT]), { title: 'Bergfex', url: 'https://bergfex.at/x' }];
	assert.deepEqual(applyMirrorRows([KOMOOT, VIDEO], rows), [
		KOMOOT,
		VIDEO,
		{ title: 'Bergfex', url: 'https://bergfex.at/x', kind: 'mirror' }
	]);
});

const file = path.resolve(__dirname, '../../../static/_projects/data-viz/hikes/markdown/2026-09-06-grosser_laber.md');
const mkDoc = (postRaw: string): HikeDoc => ({ slug: 'grosser_laber', date: '2026-09-06', sidecarRaw: '{}\n', postRaw, version: docVersion('{}\n', postRaw) });
const sourcesOf = (raw: string) => (readFrontmatterDoc(raw).doc.toJS() as any).facts?.sources;

test('the written YAML matches the existing flow style', () => {
	const raw = readFileSync(file, 'utf8');
	const same = applyOps(mkDoc(raw), [{ kind: 'mirrors', rows: mirrorRows(sourcesOf(raw)) }]);
	assert.equal(same.postRaw, raw);
	const rows = mirrorRows(sourcesOf(raw));
	rows[2].url = 'https://www.alltrails.com/trail/x';
	const added = applyOps(mkDoc(raw), [{ kind: 'mirrors', rows }]);
	assert.equal(
		added.postRaw,
		raw.replace('kind: mirror}\n---', "kind: mirror}\n    - {title: AllTrails, url: 'https://www.alltrails.com/trail/x', kind: mirror}\n---")
	);
	const cleared = rows.map((r) => ({ ...r, url: '' }));
	const gone = applyOps(mkDoc(raw), [{ kind: 'mirrors', rows: cleared }]);
	assert.ok(!/facts:|sources:/.test(gone.postRaw!.split('\n---')[0]));
});

const STRAVA_X = { title: 'Strava', url: 'https://www.strava.com/activities/2', kind: 'mirror', checked: true };
const RAW2 =
	"---\ntitle: T\nfacts:\n  sources:\n    - {title: Komoot, url: 'https://www.komoot.com/tour/1', kind: mirror}\n    - {title: Strava, url: 'https://www.strava.com/activities/2', kind: mirror, checked: true}\nimages:\n  a.jpg: {w: 1, h: 2}\n---\nB\n";

test('clearing an earlier mirror leaves a later one byte-identical', () => {
	assert.deepEqual(applyMirrorRows([KOMOOT, STRAVA_X], mirrorRows([KOMOOT, STRAVA_X]).map((r) => (r.key === 0 ? { ...r, url: '' } : r))), [STRAVA_X]);
	const rows = mirrorRows(sourcesOf(RAW2)).map((r) => (r.key === 0 ? { ...r, url: '' } : r));
	const out = applyOps(mkDoc(RAW2), [{ kind: 'mirrors', rows }]).postRaw!;
	assert.equal(out, RAW2.replace(/    - \{title: Komoot.*\n/, ''));
});

test('editing a URL keeps the entry\'s extra keys', () => {
	const rows = mirrorRows(sourcesOf(RAW2)).map((r) => (r.key === 1 ? { ...r, url: 'https://www.strava.com/activities/9' } : r));
	const out = applyOps(mkDoc(RAW2), [{ kind: 'mirrors', rows }]).postRaw!;
	assert.equal(out, RAW2.replace('activities/2', 'activities/9'));
});

const setUrl = (rows: ReturnType<typeof mirrorRows>, title: string, url: string) => rows.map((r) => (r.title === title ? { ...r, url } : r));

test('sequence: clear Komoot, adopt server rows, edit Strava keeps checked', () => {
	let src: unknown[] = [KOMOOT, STRAVA_X];
	src = applyMirrorRows(src, setUrl(mirrorRows(src), 'Komoot', ''));
	assert.deepEqual(src, [STRAVA_X]);
	const adopted = mirrorRows(src);
	assert.equal(adopted.find((r) => r.title === 'Strava')!.key, 0);
	src = applyMirrorRows(src, setUrl(adopted, 'Strava', 'https://s/9'));
	assert.deepEqual(src, [{ ...STRAVA_X, url: 'https://s/9' }]);
});

test('sequence: [A,B,C] clear A then edit C', () => {
	const m = (t: string) => ({ title: t, url: `https://${t}/`, kind: 'mirror', extra: t });
	let src: unknown[] = [m('A'), m('B'), m('C')];
	src = applyMirrorRows(src, setUrl(mirrorRows(src), 'A', ''));
	src = applyMirrorRows(src, setUrl(mirrorRows(src), 'C', 'https://c2/'));
	assert.deepEqual(src, [m('B'), { ...m('C'), url: 'https://c2/' }]);
});

test('a stale client key never rewrites a different entry', () => {
	const m = (t: string) => ({ title: t, url: `https://${t}/`, kind: 'mirror', extra: t });
	const src = [m('B'), m('C')];
	// client still thinks B is at index 1 and C at index 2 (before A was cleared)
	const stale = [
		{ title: 'B', url: 'https://B/', key: 1 },
		{ title: 'C', url: 'https://c2/', key: 2 }
	];
	assert.deepEqual(applyMirrorRows(src, stale), [m('B'), { ...m('C'), url: 'https://c2/' }]);
	// an unmatched stale row becomes a new entry and leaves the originals alone
	const out = applyMirrorRows(src, [...mirrorRows(src), { title: 'Z', url: 'https://z/', key: 1 }]);
	assert.deepEqual(out.slice(0, 2), src);
	assert.equal(out.length, 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bursts, candidates, guessAlbum } from './photo-sources';
import { setLink } from './immich-links';
import type { Asset, Immich } from './immich-client';
import type { DocRef } from './doc-ref';

const PAD = 14 * 3600e3;
const SETZBERG: DocRef = { kind: 'post', slug: 'setzberg', date: '2026-01-11' };
const A = (id: string, takenLocal: string, lat?: number, lon?: number): Asset => ({ id, fileName: `${id}.jpg`, takenLocal, width: 10, height: 10, lat, lon });

test('guessAlbum picks Germany_Tegernsee_Setzberg for setzberg', () => {
	const albums = [
		{ id: '1', name: 'Austria_Karwendel' },
		{ id: '2', name: 'Germany_Tegernsee_Setzberg' },
		{ id: '3', name: 'Setzberg_old' }
	];
	assert.deepEqual(guessAlbum('setzberg', albums), { id: '2', name: 'Germany_Tegernsee_Setzberg' }); // tie on coverage: by name
	assert.deepEqual(guessAlbum('setzberg', albums.slice(0, 2)), { id: '2', name: 'Germany_Tegernsee_Setzberg' });
	assert.equal(guessAlbum('setzberg', [albums[0]]), null);
	assert.equal(guessAlbum('marienstein_loop', [{ id: '9', name: 'Marienstein' }])?.id, '9');
	assert.equal(guessAlbum('a_b_c_d', [{ id: '9', name: 'a' }]), null);
});

test('bursts split on 31 s or 31 m and keep order', () => {
	const t = (s: number) => `2026-01-11T10:00:${String(s).padStart(2, '0')}+01:00`;
	const out = bursts([
		A('c', t(31), 47, 11),
		A('a', t(0), 47, 11),
		A('b', t(30), 47, 11),
		A('d', t(32), 47.00031, 11) // ~34 m from c
	]);
	assert.deepEqual(out.map((b) => [b.id, b.assets.map((x) => x.id)]), [['a', ['a', 'b', 'c']], ['d', ['d']]]);
	const far = bursts([A('a', t(0)), A('b', t(31))]);
	assert.equal(far.length, 2);
	const near = bursts([A('a', t(0), 47, 11), A('b', t(1), 47.00026, 11)]); // ~29 m
	assert.equal(near.length, 1);
});

test('photos without GPS group by time only', () => {
	const out = bursts([A('a', '2026-01-11T10:00:00+01:00'), A('b', '2026-01-11T10:00:20+01:00', 47, 11), A('c', '2026-01-11T10:00:40+01:00', 48, 12)]);
	assert.deepEqual(out.map((b) => b.assets.map((x) => x.id)), [['a', 'b'], ['c']]);
});

test('candidates marks assets already in the post', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cand-'));
	await setLink(root, '2026-01-11-setzberg.md', '2026-01-11-00.jpg', 'x1');
	await setLink(root, 'other.md', 'k.jpg', 'x2');
	const seen: unknown[] = [];
	const immich = {
		albums: async () => [{ id: 'al', name: 'Germany_Tegernsee_Setzberg' }],
		search: async (q: unknown) => {
			seen.push(q);
			return [A('x1', '2026-01-11T10:00:00+01:00'), A('x2', '2026-01-11T11:00:00+01:00')];
		}
	} as unknown as Immich;
	const r = await candidates(root, immich, { ref: SETZBERG, album: 'guess' });
	assert.deepEqual(r.album, { id: 'al', name: 'Germany_Tegernsee_Setzberg' });
	assert.deepEqual(r.window, { from: '2026-01-10', to: '2026-01-12' });
	assert.deepEqual(r.inPost, { x1: '2026-01-11-00.jpg' });
	assert.equal(r.bursts.length, 2);
	assert.deepEqual(seen[0], { albumId: 'al', takenAfter: new Date(new Date(2026, 0, 10).getTime() - PAD).toISOString(), takenBefore: new Date(new Date(2026, 0, 13).getTime() + PAD).toISOString() });
	await candidates(root, immich, { ref: SETZBERG, album: 'none', from: '2026-01-11', to: '2026-01-11' });
	assert.deepEqual(seen[1], { takenAfter: new Date(new Date(2026, 0, 11).getTime() - PAD).toISOString(), takenBefore: new Date(new Date(2026, 0, 12).getTime() + PAD).toISOString() });
	await candidates(root, immich, { ref: SETZBERG, album: 'zz' });
	assert.equal((seen[2] as any).albumId, 'zz');
});

test('bursts: identical timestamps order by fileName then id; invalid times go last', () => {
	const t = '2026-01-11T10:00:00+01:00';
	const mk = (id: string, fileName: string, takenLocal: string): Asset => ({ id, fileName, takenLocal, width: 1, height: 1 });
	const a = [mk('3', 'b.jpg', t), mk('2', 'a.jpg', t), mk('1', 'a.jpg', t), mk('z', 'z.jpg', ''), mk('y', 'y.jpg', 'bogus'), mk('4', 'c.jpg', '2026-01-11T10:05:00+01:00')];
	const out = bursts(a);
	assert.deepEqual(out.map((b) => b.assets.map((x) => x.id)), [['1', '2', '3'], ['4'], ['y', 'z']]);
	assert.deepEqual(bursts([...a].reverse()).map((b) => b.id), out.map((b) => b.id));
});

test('candidates pads the window, filters by local date, rejects from > to', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cand-'));
	const immich = {
		albums: async () => [],
		search: async () => [A('in', '2026-01-12T23:50:00+05:45'), A('out', '2026-01-13T00:10:00+05:45'), A('early', '2026-01-09T23:59:00-03:00'), A('bad', '')]
	} as unknown as Immich;
	const r = await candidates(root, immich, { ref: SETZBERG, album: 'none' });
	assert.deepEqual(r.bursts.map((b) => b.assets.map((x) => x.id)), [['in'], ['bad']]);
	await assert.rejects(candidates(root, immich, { ref: SETZBERG, from: '2026-01-12', to: '2026-01-10' }), (e: any) => e.status === 400);
});

test('candidates for a hike without a date say what the Photos tab needs', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cand-'));
	const immich = { albums: async () => [], search: async () => [] } as unknown as Immich;
	const hike: DocRef = { kind: 'hike', slug: 'setzberg' };
	// As every other photo route says it for a hike alone.
	await assert.rejects(candidates(root, immich, { ref: hike }), { status: 400, message: 'a dated visit or a place doc is required' });
	// Half a window: the other end is missing, as for a place doc.
	await assert.rejects(candidates(root, immich, { ref: hike, from: '2026-01-10' }), { status: 400, message: 'from and to go together' });
	// A whole window still searches.
	assert.deepEqual((await candidates(root, immich, { ref: hike, album: 'none', from: '2026-01-10', to: '2026-01-11' })).window, { from: '2026-01-10', to: '2026-01-11' });
});

test('place candidates use smart search with the title by default', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cand-'));
	const dir = path.join(root, 'static/_projects/data-viz/hikes/places');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'knorrhuette.md'), '---\ntitle: Knorrhütte\ndescription: DAV hut.\n---\n');
	await setLink(root, 'places/knorrhuette.md', '2025-07-04-00.jpg', 'k1');
	await setLink(root, '2025-07-04-knorrhuette.md', '2025-07-04-00.jpg', 'k2');
	const smart: unknown[] = [];
	const immich = {
		albums: async () => assert.fail('no album guess for a place'),
		search: async () => assert.fail('a place searches by meaning, not by date alone'),
		smart: async (q: string) => {
			smart.push(q);
			return [A('k1', '2025-07-04T10:00:00+02:00'), A('k2', '2025-07-04T12:00:00+02:00'), A('k3', '2024-02-01T09:00:00+01:00')];
		}
	} as unknown as Immich;
	const place: DocRef = { kind: 'place', slug: 'knorrhuette' };
	const r = await candidates(root, immich, { ref: place });
	assert.deepEqual(smart, ['Knorrhütte']);
	assert.equal(r.album, null);
	assert.deepEqual(r.albums, []);
	assert.deepEqual(r.window, { from: '', to: '' });
	assert.equal(r.query, 'Knorrhütte');
	assert.deepEqual(r.bursts.flatMap((b) => b.assets.map((a) => a.id)), ['k3', 'k1', 'k2']);
	assert.deepEqual(r.inPost, { k1: '2025-07-04-00.jpg' });
	// a query of its own, the date window filters by local date, album is ignored
	const w = await candidates(root, immich, { ref: place, query: ' hut terrace ', album: 'guess', from: '2025-07-01', to: '2025-07-31' });
	assert.equal(smart[1], 'hut terrace');
	assert.deepEqual(w.window, { from: '2025-07-01', to: '2025-07-31' });
	assert.deepEqual(w.bursts.flatMap((b) => b.assets.map((a) => a.id)), ['k1', 'k2']);
	await assert.rejects(candidates(root, immich, { ref: place, from: '2025-07-01' }), (e: any) => e.status === 400);
	await assert.rejects(candidates(root, immich, { ref: { kind: 'place', slug: 'nope' } }), (e: any) => e.status === 404);
});

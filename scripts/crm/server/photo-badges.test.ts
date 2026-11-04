import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { badges, photoBadges, positionAt } from './photo-badges';

const ROUTE = [[11, 47], [11.02, 47]];
const at = (m: number) => 47 + m / 111194.9;
const T = '2024-01-01T11:00:00+01:00';

test('badges: off route at 301 m, not at 299 m', () => {
	const doc = { images: { near: { lat: at(299), lon: 11.01, taken: T }, far: { lat: at(301), lon: 11.01, taken: T } } };
	const b = badges(doc, [], ROUTE);
	assert.equal(b.near, undefined);
	assert.deepEqual(b.far, ['off route']);
});

test('badges: no time, no location, outside track (15 min slack)', () => {
	const track = [{ lat: 47, lon: 11, t: Date.parse('2024-01-01T09:00:00Z') }, { lat: 47, lon: 11.01, t: Date.parse('2024-01-01T10:00:00Z') }];
	const doc = {
		images: {
			bare: { w: 1 },
			inside: { lat: 47, lon: 11, taken: '2024-01-01T11:10:00+01:00' },
			late: { lat: 47, lon: 11, taken: '2024-01-01T11:16:00+01:00' }
		}
	};
	const b = badges(doc, track, ROUTE);
	assert.deepEqual(b.bare, ['no time', 'no location']);
	assert.equal(b.inside, undefined);
	assert.deepEqual(b.late, ['outside track']);
});

test('positionAt interpolates and refuses outside the recording', () => {
	const track = [{ lat: 47, lon: 11, t: 0 }, { lat: 48, lon: 12, t: 1000 }];
	assert.deepEqual(positionAt(track, 500), { lat: 47.5, lon: 11.5 });
	assert.throws(() => positionAt(track, 2000), /outside/);
	assert.throws(() => positionAt([], 0), /no timed GPX/);
});

test('a place doc gets only the no time / no location badges', () => {
	const root = mkdtempSync(join(tmpdir(), 'badges-'));
	const dir = join(root, 'static/_projects/data-viz/hikes/places');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'foo.md'), "---\ntitle: Foo\ndescription: D\nimages:\n  a.jpg: {w: 1, h: 1}\n  b.jpg: {w: 1, h: 1, lat: 10, lon: 10, taken: '2020-01-01T10:00:00+01:00'}\n---\n");
	assert.deepEqual(photoBadges(root, { kind: 'place', slug: 'foo' }), { 'a.jpg': ['no time', 'no location'] });
});

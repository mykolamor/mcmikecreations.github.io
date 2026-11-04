import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mapPayload } from './map-data';

const H = 'static/_projects/data-viz/hikes';

function repo(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-map-'));
	const md = path.join(root, H, 'markdown');
	mkdirSync(md, { recursive: true });
	mkdirSync(path.join(root, H, 'gpx'), { recursive: true });
	mkdirSync(path.join(root, H, 'geojson'), { recursive: true });
	writeFileSync(
		path.join(md, 'foo.hike.json'),
		JSON.stringify({ name: 'Foo', origin: { lat: 47, lon: 11 }, height: 512, checkpoints: [[11.1, 47.1]], nodes: ['node/1', 'node/9'] }, null, 2) + '\n'
	);
	writeFileSync(path.join(md, 'bar.hike.json'), JSON.stringify({ name: 'Bar', checkpoints: [[12, 48]] }) + '\n');
	writeFileSync(path.join(md, 'empty.hike.json'), JSON.stringify({ name: 'Empty' }) + '\n');
	writeFileSync(
		path.join(md, '2024-01-01-foo.md'),
		'---\ntitle: T\norigin: {lat: 47.5, lon: 11.5}\nimages:\n  2024-01-01-00.jpg: {w: 1, h: 1, lat: 47.2, lon: 11.2}\n  2024-01-01-01.jpg: {w: 1, h: 1}\n---\n![Nice view](/images/x/2024-01-01-00.jpg)\n'
	);
	writeFileSync(path.join(root, H, 'gpx', 'foo.gpx'), '<gpx></gpx>');
	writeFileSync(path.join(root, H, 'geojson', 'foo.json'), '{}');
	writeFileSync(
		path.join(root, H, 'osm.json'),
		JSON.stringify({ 'node/1': { lat: 47.01, lon: 11.01, tags: { name: 'Peak', natural: 'peak' }, local: { name: 'Gipfel' } } }) + '\n'
	);
	return root;
}

test('uses post overrides and site gpx defaults', () => {
	const p = mapPayload(repo(), 'foo', '2024-01-01');
	assert.deepEqual(p.origin, { lat: 47.5, lon: 11.5 });
	assert.equal(p.height, 512);
	assert.deepEqual(p.overrides, { origin: true, height: false, checkpoints: false });
	assert.match(p.gpxUrl!, /^\/_projects\/data-viz\/hikes\/gpx\/foo\.gpx\?v=/);
	assert.match(p.routeUrl!, /^\/_projects\/data-viz\/hikes\/geojson\/foo\.json\?v=/);
	assert.deepEqual(p.checkpoints, [[11.1, 47.1]]);
	assert.deepEqual(p.nodes, [{ ref: 'node/1', name: 'Gipfel', kind: 'natural=peak', lat: 47.01, lon: 11.01, local: { name: 'Gipfel' } }]);
});

test('others excludes the current hike', () => {
	const p = mapPayload(repo(), 'foo', '2024-01-01');
	assert.deepEqual(p.others, [{ slug: 'bar', name: 'Bar', checkpoints: [[12, 48]] }]);
});

test('photos come from images entries with lat/lon', () => {
	const p = mapPayload(repo(), 'foo', '2024-01-01');
	assert.deepEqual(p.photos, [{ key: '2024-01-01-00.jpg', lat: 47.2, lon: 11.2, caption: 'Nice view' }]);
});

test('without a post the sidecar values are used and urls are null when files are missing', () => {
	const p = mapPayload(repo(), 'bar', null);
	assert.equal(p.origin, null);
	assert.equal(p.gpxUrl, null);
	assert.equal(p.routeUrl, null);
});

test('file urls are versioned by file mtime only, so a checkpoint edit keeps them', () => {
	const root = repo();
	const a = mapPayload(root, 'foo', '2024-01-01');
	writeFileSync(path.join(root, H, 'markdown', 'foo.hike.json'), JSON.stringify({ name: 'Foo', height: 512, checkpoints: [[1, 2], [3, 4]] }) + '\n');
	const b = mapPayload(root, 'foo', '2024-01-01');
	assert.notEqual(a.version, b.version);
	assert.equal(b.routeUrl, a.routeUrl);
	assert.equal(b.gpxUrl, a.gpxUrl);
	assert.match(a.routeUrl!, /\?v=\d+$/);
});

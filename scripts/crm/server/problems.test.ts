import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeTempRepo } from './test-repo';
import { problemsFor, storeProblems } from './problems';
import { repoPaths } from './paths';
import { listHikes, suggestions } from './hikes-index';
import { loadHikesFrom, postResolverFor } from '../../load-hikes.js';

test('a valid hike reports nothing', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	// geojson is not copied into the temp repo; the real one exists, so stub it
	mkdirSync(p.geojson, { recursive: true });
	writeFileSync(`${p.geojson}/grosser_laber.json`, '{}');
	assert.deepEqual(problemsFor(root, 'grosser_laber', '2026-09-06'), []);
});

test('the Node scripts and the CRM read a translated sidecar name as English', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	const sc = `${p.markdown}/grosser_laber.hike.json`;
	const j = JSON.parse(readFileSync(sc, 'utf8'));
	writeFileSync(sc, JSON.stringify({ ...j, name: { en: j.name, de: 'Großer Laber (de)' }, description: { en: j.description, de: 'Über.' } }));
	// load-hikes.js: what the feeds, map-download and the CRM's tiles and problems read.
	const hike = loadHikesFrom(p.static, p.hikesJson, { fresh: true }).find((h: any) => h.route.endsWith('/grosser_laber'))!;
	assert.equal(hike.name, j.name);
	assert.equal(hike.description, j.description);
	assert.equal(postResolverFor(p.static)(hike, hike.properties.dates[0]).name, j.name);
	// The CRM's hike list, and the problems that name hikes.
	assert.equal(listHikes(root).hikes.find((h) => h.slug === 'grosser_laber')?.name, j.name);
	const messages = [...storeProblems(root), ...problemsFor(root, 'grosser_laber', '2026-09-06')].map((x) => x.message).join('\n');
	assert.doesNotMatch(messages, /object Object/);
});

test('load-hikes.js ignores translation files', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	const before = loadHikesFrom(p.static, p.hikesJson, { fresh: true });
	writeFileSync(`${p.markdown}/2026-09-06-grosser_laber.de.md`, '---\ntitle: Großer Laber (de)\n---\nDie Wanderung.\n');
	const after = loadHikesFrom(p.static, p.hikesJson, { fresh: true });
	assert.deepEqual(after, before);
	const dates = after.find((h: any) => h.route.endsWith('/grosser_laber'))!.properties.dates;
	assert.ok(!dates.some((d: any) => d.path.includes('.de.')));
});

test('load-hikes.js rejects a translation in an unknown language', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	writeFileSync(`${p.markdown}/2026-09-06-grosser_laber.fr.md`, '---\ntitle: Grand Laber\n---\n');
	assert.throws(() => loadHikesFrom(p.static, p.hikesJson, { fresh: true }), {
		message: 'Unknown language "fr" in 2026-09-06-grosser_laber.fr.md (de)'
	});
});

test('a sidecar without origin and image reports both', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	const sc = `${p.markdown}/grosser_laber.hike.json`;
	const j = JSON.parse(readFileSync(sc, 'utf8'));
	delete j.origin;
	delete j.image;
	writeFileSync(sc, JSON.stringify(j));
	const msgs = problemsFor(root, 'grosser_laber', '2026-09-06').map((x) => x.message).join('\n');
	assert.match(msgs, /origin/);
	assert.match(msgs, /image/);
	assert.match(msgs, /GeoJSON/i);
});

test('suggestions sort by use count then name', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-sug-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	mkdirSync(p.places, { recursive: true });
	mkdirSync(path.join(root, 'src/lib/data'), { recursive: true });
	writeFileSync(path.join(p.markdown, '2024-01-01-a.md'), '---\ntags: [b, a]\npeople: [Zed]\n---\n');
	writeFileSync(path.join(p.markdown, '2024-01-02-a.md'), '---\ntags: [b, c]\nplaces: [hut]\n---\n');
	writeFileSync(path.join(p.places, 'hut.md'), '---\n---\n');
	writeFileSync(path.join(p.places, 'alm.md'), '---\n---\n');
	writeFileSync(path.join(root, 'src/lib/data/contacts.json'), '{"Ann": {}, "Zed": {}}');
	assert.deepEqual(suggestions(root, 'tags'), ['b', 'a', 'c']);
	assert.deepEqual(suggestions(root, 'people'), ['Zed', 'Ann']);
	assert.deepEqual(suggestions(root, 'places'), ['hut', 'alm']);
});

test('a broken OTHER hike is a site problem, not an error for this hike', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	mkdirSync(p.geojson, { recursive: true });
	writeFileSync(`${p.geojson}/grosser_laber.json`, '{}');
	writeFileSync(`${p.markdown}/2030-01-01-zzz_orphan.md`, '---\ntitle: x\n---\n');
	const probs = problemsFor(root, 'grosser_laber', '2026-09-06');
	assert.ok(probs.some((x) => x.level === 'site' && /Site build \(any hike\)/.test(x.message) && /zzz_orphan/.test(x.message)));
	assert.ok(!probs.some((x) => x.level === 'error'));
});

test('problemsFor re-reads the repo on every call', () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	mkdirSync(p.geojson, { recursive: true });
	writeFileSync(`${p.geojson}/grosser_laber.json`, '{}');
	assert.deepEqual(problemsFor(root, 'grosser_laber', '2026-09-06'), []);
	writeFileSync(`${p.markdown}/2030-01-01-zzz_orphan.md`, '---\ntitle: x\n---\n');
	assert.ok(problemsFor(root, 'grosser_laber', '2026-09-06').some((x) => x.level === 'site'));
	rmSync(`${p.markdown}/2030-01-01-zzz_orphan.md`);
	assert.deepEqual(problemsFor(root, 'grosser_laber', '2026-09-06'), []);
});

test('storeProblems flags duplicate lat/lon, name and wikidata, and a missing ref', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'crm-store-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	const el = (lat: number, lon: number, tags: Record<string, string>, local?: Record<string, unknown>) => ({ lat, lon, tags, ...(local ? { local } : {}) });
	writeFileSync(
		p.osmStore,
		JSON.stringify({
			'node/1': el(47.5, 11.25, { name: 'Hut', wikidata: 'Q1' }),
			'node/2': el(47.5, 11.25, { name: 'Other' }),
			'node/3': el(47.6, 11.3, { name: 'Hut' }),
			'node/4': el(47.7, 11.4, { name: 'Peak', wikidata: 'Q1' }),
			// a local null hides the OSM name, so it is no duplicate
			'node/5': el(47.8, 11.5, { name: 'Peak' }, { name: null })
		})
	);
	writeFileSync(path.join(p.markdown, 'aaa.hike.json'), JSON.stringify({ name: 'Aaa', nodes: ['node/1', 'node/3'] }));
	writeFileSync(path.join(p.markdown, 'bbb.hike.json'), JSON.stringify({ name: 'Bbb', nodes: ['node/1', 'node/9'] }));
	const store = 'static/_projects/data-viz/hikes/osm.json';
	assert.deepEqual(storeProblems(root), [
		{ level: 'warning', file: store, message: 'Duplicate lat/lon: 47.5,11.25 for: node/2 node/1 (node/2 in: no hike (photo pins only); node/1 in: Aaa, Bbb)' },
		{ level: 'warning', file: store, message: 'Duplicate name: Hut for: node/3 node/1 (node/3 in: Aaa; node/1 in: Aaa, Bbb)' },
		{ level: 'warning', file: store, message: 'Duplicate wikidata: Q1 for: node/4 node/1 (node/4 in: no hike (photo pins only); node/1 in: Aaa, Bbb)' },
		{ level: 'error', file: 'static/_projects/data-viz/hikes/markdown/bbb.hike.json', message: 'unknown OSM element node/9' }
	]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isTranslationFile } from './translations';
import { makeTempRepo } from './test-repo';
import { readDocFacts } from './facts-read';
import { problemsFor } from './problems';
import { repoPaths } from './paths';
import { ApiError } from './errors';

const REAL = path.resolve(__dirname, '../../..');

/** The test repo with the real route files too, as the page reads them. */
function repoWithRoutes(): string {
	const root = makeTempRepo();
	cpSync(repoPaths(REAL).geojson, repoPaths(root).geojson, { recursive: true });
	return root;
}

const posts = (root: string) =>
	readdirSync(repoPaths(root).markdown).flatMap((f) => {
		const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(f);
		return m && !isTranslationFile(f) ? [{ kind: 'post' as const, slug: m[2], date: m[1] }] : [];
	});

test("readDocFacts matches the page's reading for every real post", () => {
	const root = repoWithRoutes();
	const all = posts(root);
	assert.ok(all.length > 0);
	for (const ref of all) {
		const r = readDocFacts(root, ref);
		assert.equal(r.error, null, `${ref.date}-${ref.slug}`);
		// The page's own inputs: the route as drawn, and the factor onto the stated distance.
		if (existsSync(path.join(repoPaths(root).geojson, `${ref.slug}.json`))) assert.ok(r.coords.length > 0, ref.slug);
		assert.ok(r.distanceFactor > 0);
	}
});

test("a draft replaces the file's facts", () => {
	const root = makeTempRepo();
	const ref = { kind: 'post' as const, slug: 'grosser_laber', date: '2026-09-06' };
	const own = readDocFacts(root, ref);
	const drafted = readDocFacts(root, ref, { draft: { post: { drones: 'Not here' }, hike: {} } });
	assert.equal(drafted.error, null);
	assert.deepEqual(drafted.facts?.drones, { en: 'Not here' });
	assert.notDeepEqual(drafted.facts, own.facts);
	// undefined keeps the file's own.
	assert.deepEqual(readDocFacts(root, ref, { draft: { post: undefined } }).facts, own.facts);
});

test('a malformed draft returns the error, not a failure', () => {
	const root = makeTempRepo();
	const r = readDocFacts(root, { kind: 'post', slug: 'grosser_laber', date: '2026-09-06' }, { draft: { post: { plan: { timing: { start: '7:' } } } } });
	assert.equal(r.facts, null);
	assert.match(r.error ?? '', /plan\.timing\.start/);
});

test('a place doc has no facts', () => {
	assert.throws(() => readDocFacts(makeTempRepo(), { kind: 'place', slug: 'x' }), (e) => e instanceof ApiError && e.status === 400);
});

test('problems list a facts error of this hike', () => {
	const root = makeTempRepo();
	const sc = path.join(repoPaths(root).markdown, 'grosser_laber.hike.json');
	const j = JSON.parse(readFileSync(sc, 'utf8'));
	writeFileSync(sc, JSON.stringify({ ...j, facts: { plan: { timing: { start: '7:' } } } }));
	const bad = problemsFor(root, 'grosser_laber', '2026-09-06').filter((p) => p.level === 'error');
	assert.equal(bad.length, 1);
	assert.match(bad[0].message, /plan\.timing\.start/);
	assert.equal(bad[0].file, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHikeSort, latestVisit, sortHikes } from './hike-sort';

const hike = (slug: string, name: string, posts: string[] = [], postless: string[] = []) => ({
	slug,
	name,
	posts: posts.map((date) => ({ date })),
	postlessDates: postless
});
const a = hike('zugspitze', 'Alpspitze loop', ['2023-05-01']);
const b = hike('alp_trail', 'Zugspitze', [], ['2024-07-10']);
const c = hike('middle', 'Middle walk');
const d = hike('mid2', 'Middle walk', ['2024-07-10', '2022-01-01']);

test('latestVisit takes the newest of post and post-less dates', () => {
	assert.equal(latestVisit(hike('x', 'X', ['2022-01-01', '2024-03-01'], ['2023-12-31'])), '2024-03-01');
	assert.equal(latestVisit(hike('x', 'X', ['2022-01-01'], ['2023-12-31'])), '2023-12-31');
	assert.equal(latestVisit(c), '');
});
test('sortHikes by name, slug and latest visit', () => {
	const slugs = (by: Parameters<typeof sortHikes>[1]) => sortHikes([a, b, c, d], by).map((h) => h.slug);
	assert.deepEqual(slugs('name'), ['zugspitze', 'mid2', 'middle', 'alp_trail']);
	assert.deepEqual(slugs('slug'), ['alp_trail', 'mid2', 'middle', 'zugspitze']);
	// Same latest date: by name; no visit at all: last.
	assert.deepEqual(slugs('visit'), ['mid2', 'alp_trail', 'zugspitze', 'middle']);
});
test('sortHikes leaves its input alone', () => {
	const list = [b, a];
	sortHikes(list, 'name');
	assert.deepEqual(list, [b, a]);
});
test('isHikeSort accepts only known values', () => {
	assert.ok(isHikeSort('visit'));
	assert.ok(!isHikeSort('date'));
	assert.ok(!isHikeSort(null));
});

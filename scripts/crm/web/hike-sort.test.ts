import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortHikes } from './hike-sort';

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

test('sortHikes by latest visit (posts and post-less dates), by name and by slug', () => {
	const slugs = (by: Parameters<typeof sortHikes>[1]) => sortHikes([a, b, c, d], by).map((h) => h.slug);
	// Same latest date: by name; no visit at all: last.
	assert.deepEqual(slugs('visit'), ['mid2', 'alp_trail', 'zugspitze', 'middle']);
	assert.deepEqual(slugs('name'), ['zugspitze', 'mid2', 'middle', 'alp_trail']);
	assert.deepEqual(slugs('slug'), ['alp_trail', 'mid2', 'middle', 'zugspitze']);
});

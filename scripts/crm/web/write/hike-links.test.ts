import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hikeLinkChange, hikePosts, searchHikes, typedLinkStart } from './hike-links';
import { hikeLinkInsert } from '../../shared/md-lines';

const HIKES = [
	{ slug: 'zugspitze_reintal', posts: [{ date: '2025-06-21', path: '/x/2025-06-21-zugspitze_reintal.md', title: 'Zugspitze through the Reintal' }] },
	{
		slug: 'wallberg',
		posts: [
			{ date: '2024-10-03', path: '/x/2024-10-03-wallberg.md', title: 'Wallberg in autumn' },
			{ date: '2023-05-01', path: '/x/2023-05-01-wallberg.md', title: 'Wallberg' }
		]
	},
	{ slug: 'knorrhuette', posts: [{ date: '2022-08-14', path: '/x/2022-08-14-knorrhuette.md', title: 'Über die Knorrhütte' }] }
];

test('hike search matches title, date and slug', () => {
	const posts = hikePosts(HIKES);
	// Newest first.
	assert.deepEqual(posts.map((p) => p.date), ['2025-06-21', '2024-10-03', '2023-05-01', '2022-08-14']);
	const find = (q: string) => searchHikes(posts, q).map((p) => `${p.date}-${p.slug}`);
	// Title words, any case, accents folded.
	assert.deepEqual(find('reintal'), ['2025-06-21-zugspitze_reintal']);
	assert.deepEqual(find('uber knorr'), ['2022-08-14-knorrhuette']);
	assert.deepEqual(find('AUTUMN'), ['2024-10-03-wallberg']);
	// The date, whole or in part.
	assert.deepEqual(find('2023-05'), ['2023-05-01-wallberg']);
	assert.deepEqual(find('2024-10-03'), ['2024-10-03-wallberg']);
	// The slug, as written or with its underscores as spaces.
	assert.deepEqual(find('zugspitze_reintal'), ['2025-06-21-zugspitze_reintal']);
	assert.deepEqual(find('knorrhuette'), ['2022-08-14-knorrhuette']);
	// Every word must match; one character is enough to start.
	assert.deepEqual(find('wallberg 2023'), ['2023-05-01-wallberg']);
	assert.equal(find('w').length, 2);
	assert.deepEqual(find(''), []);
	assert.deepEqual(find('   '), []);
	assert.deepEqual(find('nowhere'), []);
});

test('a typed [[ is replaced by the link; from the button the link goes in at the cursor', () => {
	const post = { title: 'Wallberg', date: '2023-05-01', slug: 'wallberg' };
	// `[[` just typed: its start.
	assert.equal(typedLinkStart('See [[', 6, '['), 4);
	assert.equal(typedLinkStart('See [[', 6, '[['), 4);
	assert.equal(typedLinkStart('See [x', 6, 'x'), null);
	assert.equal(typedLinkStart('See [[ ', 7, ' '), null);
	const body = 'See [[ here';
	const change = hikeLinkChange(body, 6, post, 4);
	assert.deepEqual(change, { ...hikeLinkInsert(4, 'Wallberg', '2023-05-01', 'wallberg'), to: 6 });
	const out = body.slice(0, change.from) + change.insert + body.slice(change.to);
	assert.equal(out, 'See [Wallberg](/hikes/2023-05-01-wallberg/) here');
	assert.equal(out.slice(change.selFrom, change.selTo), 'Wallberg');
	// The `[[` is gone (edited away meanwhile): inserted at the cursor instead.
	assert.deepEqual(hikeLinkChange('See  here', 4, post, 4), hikeLinkInsert(4, 'Wallberg', '2023-05-01', 'wallberg'));
	assert.deepEqual(hikeLinkChange(body, 11, post, null), hikeLinkInsert(11, 'Wallberg', '2023-05-01', 'wallberg'));
});

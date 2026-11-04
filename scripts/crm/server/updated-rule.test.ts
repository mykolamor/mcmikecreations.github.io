import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitPublished, localToday, maybeStampUpdated } from './updated-rule';

const MD = 'static/_projects/data-viz/hikes/markdown';

function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), 'updated-rule-'));
	mkdirSync(join(root, MD), { recursive: true });
	execFileSync('git', ['init', '-q'], { cwd: root });
	return root;
}

function commit(root: string): void {
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x'], { cwd: root });
}

test('stamps updated only for posts committed in HEAD and once per day', async () => {
	const root = gitRepo();
	const tracked = join(root, MD, '2024-01-01-foo.md');
	const draft = join(root, MD, '2024-02-02-bar.md');
	const raw = '---\ntitle: Foo\nimages:\n  a.jpg: {w: 1, h: 1}\n---\nBody\n';
	writeFileSync(tracked, raw);
	writeFileSync(draft, raw);
	execFileSync('git', ['add', tracked], { cwd: root });
	commit(root);
	execFileSync('git', ['add', draft], { cwd: root }); // staged (e.g. by the IDE) but never committed: not published

	assert.equal(gitPublished(root, tracked), true);
	assert.equal(gitPublished(root, draft), false);

	assert.deepEqual(await maybeStampUpdated(root, '2024-02-02-bar.md'), { stamped: false });
	assert.equal(readFileSync(draft, 'utf8'), raw);

	const today = localToday();
	assert.deepEqual(await maybeStampUpdated(root, '2024-01-01-foo.md'), { stamped: true, previous: null });
	assert.equal(readFileSync(tracked, 'utf8'), `---\ntitle: Foo\nupdated: ${today}\nimages:\n  a.jpg: {w: 1, h: 1}\n---\nBody\n`);
	const once = readFileSync(tracked, 'utf8');
	assert.deepEqual(await maybeStampUpdated(root, tracked), { stamped: false });
	assert.equal(readFileSync(tracked, 'utf8'), once);
});

test('an older updated is replaced in place and returned as previous', async () => {
	const root = gitRepo();
	const post = join(root, MD, '2024-01-01-foo.md');
	writeFileSync(post, '---\ntitle: Foo\nupdated: 2023-03-03\ntags: [a]\n---\nBody\n');
	execFileSync('git', ['add', post], { cwd: root });
	commit(root);
	assert.deepEqual(await maybeStampUpdated(root, post, { today: () => '2030-01-02' }), { stamped: true, previous: '2023-03-03' });
	assert.equal(readFileSync(post, 'utf8'), '---\ntitle: Foo\nupdated: 2030-01-02\ntags: [a]\n---\nBody\n');
});

test('not a git repo means not published', async () => {
	const root = mkdtempSync(join(tmpdir(), 'updated-rule-'));
	mkdirSync(join(root, MD), { recursive: true });
	writeFileSync(join(root, MD, '2024-01-01-foo.md'), '---\ntitle: Foo\n---\n');
	assert.equal(gitPublished(root, join(root, MD, '2024-01-01-foo.md')), false);
});

test('localToday uses the local calendar day', () => {
	assert.equal(localToday(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
	assert.equal(localToday(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});

test('a committed place doc is never stamped updated', async () => {
	const root = gitRepo();
	const dir = join(root, 'static/_projects/data-viz/hikes/places');
	mkdirSync(dir, { recursive: true });
	const place = join(dir, 'knorrhuette.md');
	const raw = '---\ntitle: Knorrhütte\ndescription: DAV hut.\n---\n';
	writeFileSync(place, raw);
	execFileSync('git', ['add', place], { cwd: root });
	commit(root);
	assert.deepEqual(await maybeStampUpdated(root, place, { today: () => '2026-10-29' }), { stamped: false });
	assert.equal(readFileSync(place, 'utf8'), raw);
});

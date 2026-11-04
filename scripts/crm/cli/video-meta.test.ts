import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPaths } from '../server/paths';
import { createStubFetcher, type VideoFetcher } from '../server/video-meta';
import { parseArgs } from './index';
import { recorder } from './test-output';
import { fetchVideoMeta } from './video-meta';

const VID = 'B5yRsnelCsw';
const POSTERS = 'static/images/projects/data-viz/hikes/videos';
const POST = '2024-01-01-foo.md';
const LINE = `![Climb](https://www.youtube.com/watch?v=${VID})`;
const post = (front: string, body = `Text\n\n${LINE}\n`) => `---\ntitle: T # kept\n${front}---\n${body}`;

function setup(content = post('')) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-video-'));
	const p = repoPaths(root);
	mkdirSync(p.markdown, { recursive: true });
	writeFileSync(join(p.markdown, POST), content);
	return { root, file: join(p.markdown, POST) };
}

function counting(over: Partial<VideoFetcher> = {}): VideoFetcher & { calls: number } {
	const stub = createStubFetcher();
	const f: VideoFetcher & { calls: number } = {
		calls: 0,
		page: async (id) => (f.calls++, stub.page(id)),
		localized: stub.localized,
		thumbnail: stub.thumbnail,
		...over
	};
	return f;
}

const go = (root: string, fetcher: VideoFetcher, argv: string[] = []) => {
	const out = recorder();
	return fetchVideoMeta(root, parseArgs(['video-meta', ...argv]), out, fetcher).then((code) => ({ code, out }));
};

test('a missing entry is fetched and written with blur last', async () => {
	const s = setup();
	const { code, out } = await go(s.root, counting());
	assert.equal(code, 0);
	const text = readFileSync(s.file, 'utf8');
	assert.match(text, new RegExp(`^---\\ntitle: T # kept\\nvideos:\\n  ${VID}: \\{uploadDate: [^,]+, duration: [^,]+, title: \\{en: .+\\}, description: \\{en: .+\\}, w: \\d+, h: \\d+, blur: .+\\}\\n---\\n`));
	assert.ok(text.endsWith(`}\n---\nText\n\n${LINE}\n`));
	assert.ok(existsSync(join(s.root, POSTERS, `${VID}.jpg`)));
	assert.deepEqual(out.changes, ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md: set 1 video(s)']);
	assert.deepEqual(out.summaries, ['video-meta: 1 video updated across 1 post']);
});

test('complete entries with a poster are left alone', async () => {
	const s = setup();
	await go(s.root, counting());
	const edited = readFileSync(s.file, 'utf8').replace('description: {en: ', 'description: {en: hand edit ');
	writeFileSync(s.file, edited);
	const f = counting();
	const { code, out } = await go(s.root, f);
	assert.equal(code, 0);
	assert.equal(f.calls, 0);
	assert.equal(readFileSync(s.file, 'utf8'), edited);
	assert.deepEqual(out.changes, []);
});

test('an entry with no line in the body is removed', async () => {
	const s = setup();
	await go(s.root, counting());
	const withStale = readFileSync(s.file, 'utf8').replace(`\n  ${VID}:`, `\n  Stale000000: {uploadDate: x}\n  ${VID}:`);
	writeFileSync(s.file, withStale);
	const { out } = await go(s.root, counting());
	assert.equal(readFileSync(s.file, 'utf8'), withStale.replace('  Stale000000: {uploadDate: x}\n', ''));
	assert.deepEqual(out.changes, ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md: removed 1 video(s)']);
});

test('the videos key goes when its last entry does', async () => {
	const s = setup(post("videos:\n  Stale000000: {uploadDate: x}\n", 'No video here\n'));
	const { code } = await go(s.root, counting());
	assert.equal(code, 0);
	assert.equal(readFileSync(s.file, 'utf8'), post('', 'No video here\n'));
});

test('offline video-meta warns and exits 0', async () => {
	const s = setup();
	const before = readFileSync(s.file, 'utf8');
	const offline = counting({
		page: async () => {
			throw new Error('getaddrinfo ENOTFOUND www.youtube.com');
		}
	});
	const { code, out } = await go(s.root, offline);
	assert.equal(code, 0);
	assert.equal(readFileSync(s.file, 'utf8'), before);
	assert.ok(out.warnings.some((w) => w.includes(`could not fetch ${VID}`) && w.includes('ENOTFOUND')), out.warnings.join('\n'));
	assert.deepEqual(out.changes, []);
});

test('a private video gets unavailable: true', async () => {
	const s = setup(post('', 'Text\n\n![P](https://www.youtube.com/watch?v=PrivateVid1)\n'));
	const { code, out } = await go(s.root, counting());
	assert.equal(code, 0);
	assert.ok(readFileSync(s.file, 'utf8').includes('videos:\n  PrivateVid1: {unavailable: true}\n'));
	assert.ok(out.warnings.some((w) => w.includes("PrivateVid1 isn't public")));
});

test('--refresh refetches a complete entry', async () => {
	const s = setup();
	await go(s.root, counting());
	const f = counting();
	const { out } = await go(s.root, f, ['--refresh']);
	assert.ok(f.calls > 0);
	assert.equal(out.summaries.length, 1);
	const g = counting();
	await go(s.root, g);
	assert.equal(g.calls, 0);
});

test('--dry-run reports and writes nothing', async () => {
	const s = setup();
	const before = readFileSync(s.file, 'utf8');
	const { out } = await go(s.root, counting(), ['--dry-run']);
	assert.equal(readFileSync(s.file, 'utf8'), before);
	assert.ok(!existsSync(join(s.root, POSTERS, `${VID}.jpg`)));
	assert.deepEqual(out.changes, ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md: would fetch 1 video(s)']);
});

test('a second run changes nothing', async () => {
	const s = setup();
	await go(s.root, counting());
	const once = readFileSync(s.file, 'utf8');
	const f = counting();
	const { code, out } = await go(s.root, f);
	assert.equal(code, 0);
	assert.equal(readFileSync(s.file, 'utf8'), once);
	assert.equal(f.calls, 0);
	assert.deepEqual(out.changes, []);
});

/** The post after a first run with the video on its own line, its body then replaced by `body`. */
async function withBody(body: string) {
	const s = setup();
	await go(s.root, counting());
	const text = readFileSync(s.file, 'utf8').replace(`Text\n\n${LINE}\n`, body);
	writeFileSync(s.file, text);
	return { ...s, text };
}

test("an inline embed's entry is kept", async () => {
	const s = await withBody(`Text with ${LINE} inside, and more.\n`);
	const f = counting();
	const { code, out } = await go(s.root, f);
	assert.equal(code, 0);
	assert.equal(readFileSync(s.file, 'utf8'), s.text);
	assert.equal(f.calls, 0);
	assert.deepEqual(out.changes, []);
});

test("a list-item embed's entry is kept", async () => {
	for (const body of [`- one\n- ${LINE}\n`, `> ${LINE}\n`]) {
		const s = await withBody(body);
		const { code, out } = await go(s.root, counting());
		assert.equal(code, 0);
		assert.equal(readFileSync(s.file, 'utf8'), s.text, body);
		assert.deepEqual(out.changes, [], body);
	}
});

test("a prose link to YouTube doesn't count", async () => {
	for (const body of [`See [Climb](https://www.youtube.com/watch?v=${VID}).\n`, `![Climb](https://youtu.be/${VID})\n`, '```\n' + LINE + '\n```\n']) {
		const s = await withBody(body);
		const { code, out } = await go(s.root, counting());
		assert.equal(code, 0);
		assert.ok(!readFileSync(s.file, 'utf8').includes('videos:'), body);
		assert.deepEqual(out.changes, ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md: removed 1 video(s)'], body);
	}
});

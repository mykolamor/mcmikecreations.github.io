import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { createApi, defaultRoutes } from './api';
import { handleHttp } from './http';
import { loadDoc } from './doc';
import { ApiError } from './errors';
import type { DocRef } from './doc-ref';
import { createStubFetcher, type VideoFetcher } from './video-meta';
import { addYoutube, setVideoEntry, uploadVideo } from './write-ops';

const MD = 'static/_projects/data-viz/hikes/markdown';
const STORIES = 'static/images/projects/data-viz/hikes/stories';
const PLACES_MD = 'static/_projects/data-viz/hikes/places';
const PLACE_IMAGES = 'static/images/projects/data-viz/hikes/places';
const FOO: DocRef = { kind: 'post', slug: 'foo', date: '2024-01-01' };
const VID = 'B5yRsnelCsw';

function repo(post: string): string {
	const root = mkdtempSync(join(tmpdir(), 'write-ops-'));
	mkdirSync(join(root, MD), { recursive: true });
	writeFileSync(join(root, MD, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(root, MD, '2024-01-01-foo.md'), post);
	return root;
}
const postOf = (root: string) => readFileSync(join(root, MD, '2024-01-01-foo.md'), 'utf8');
const version = (root: string) => loadDoc(root, 'foo', '2024-01-01').version;
const deps = { isTracked: () => false, today: () => '2026-10-29' };

/** A minimal ISO-BMFF file: an `ftyp` box (isom) and some payload. */
function mp4(payload = 4096): Buffer {
	const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2')]);
	return Buffer.concat([ftyp, Buffer.alloc(payload, 7)]);
}
async function* chunks(buf: Buffer, size = 1000): AsyncIterable<Buffer> {
	for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

const POST = `---
title: Foo
images:
  2024-01-01-00.jpg: {w: 10, h: 10, blur: 'data:x'}
  2024-01-01-03.jpg: {w: 10, h: 10, blur: 'data:x'}
---
Text.
`;

test('video upload streams to <date>-NN.mp4 and refuses a non-mp4', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	const dir = join(root, STORIES, 'foo');
	// Through the HTTP adapter: the route gets the request stream, not a buffered body.
	const server = createServer((req, res) => void handleHttp(createApi(root, defaultRoutes()), req, res));
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	try {
		const port = (server.address() as AddressInfo).port;
		const file = mp4(300_000);
		const res = await fetch(`http://127.0.0.1:${port}/api/write/video?slug=foo&date=2024-01-01&base=${encodeURIComponent(version(root))}`, { method: 'PUT', body: new Uint8Array(file), headers: { 'content-type': 'video/mp4' } });
		const out = (await res.json()) as { href: string; version: string; stamped: boolean };
		assert.equal(res.status, 200, JSON.stringify(out));
		assert.equal(out.href, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.mp4');
		assert.equal(out.stamped, false);
		assert.equal(out.version, version(root));
		assert.deepEqual(readFileSync(join(dir, '2024-01-01-00.mp4')), file);
		assert.deepEqual(readdirSync(dir), ['2024-01-01-00.mp4']);
	} finally {
		server.close();
	}
	// Not an mp4: 400, nothing left behind.
	await assert.rejects(uploadVideo(root, FOO, chunks(Buffer.from('\xff\xd8\xff\xe0 not a video at all')), version(root), deps), (e) => e instanceof ApiError && e.status === 400);
	assert.deepEqual(readdirSync(dir), ['2024-01-01-00.mp4']);
	// Over the size cap: 413, nothing left behind.
	await assert.rejects(uploadVideo(root, FOO, chunks(mp4(5000)), version(root), { ...deps, maxBytes: 4000 }), (e) => e instanceof ApiError && e.status === 413);
	assert.deepEqual(readdirSync(dir), ['2024-01-01-00.mp4']);
	// A stale base: 409, nothing left behind.
	await assert.rejects(uploadVideo(root, FOO, chunks(mp4()), 'stale', deps), (e) => e instanceof ApiError && e.status === 409);
	assert.deepEqual(readdirSync(dir), ['2024-01-01-00.mp4']);
	// A published post gets `updated:` stamped, as for photos.
	const r = await uploadVideo(root, FOO, chunks(mp4()), version(root), { ...deps, isTracked: () => true });
	assert.equal(r.stamped, true);
	assert.equal(r.previous, null);
	assert.match(postOf(root), /\nupdated: 2026-10-29\n/);
});

test('a non-mp4 is refused at its first bytes, before the rest is read', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	let pulled = 0;
	async function* jpegish(): AsyncIterable<Buffer> {
		for (let i = 0; i < 100; i++) {
			pulled++;
			yield Buffer.alloc(1000, i === 0 ? 0xff : 1);
		}
	}
	await assert.rejects(uploadVideo(root, FOO, jpegish(), version(root), deps), (e) => e instanceof ApiError && e.status === 400);
	assert.ok(pulled <= 2, `read ${pulled} chunks`);
	assert.deepEqual(readdirSync(join(root, STORIES, 'foo')), []);
});

test('an aborted upload leaves no temp file', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	async function* aborted(): AsyncIterable<Buffer> {
		yield mp4(2000);
		throw Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
	}
	await assert.rejects(uploadVideo(root, FOO, aborted(), version(root), deps), /aborted/);
	assert.deepEqual(readdirSync(join(root, STORIES, 'foo')), []);
});

test('the video route refuses a declared size over 2 GB with 413', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	let pulled = 0;
	async function* body(): AsyncIterable<Buffer> {
		pulled++;
		yield mp4();
	}
	const q = new URLSearchParams({ slug: 'foo', date: '2024-01-01', base: version(root) });
	const res = await createApi(root)({ method: 'PUT', path: '/api/write/video', query: q, headers: { 'content-length': String(3 * 1024 ** 3) }, stream: body() });
	assert.equal(res.status, 413);
	assert.equal(pulled, 0);
	assert.equal(existsSync(join(root, STORIES, 'foo')), false);
});

test('video numbering continues after the post\'s photos', async () => {
	const root = repo(POST);
	const a = await uploadVideo(root, FOO, chunks(mp4()), version(root), deps);
	assert.equal(a.href, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-04.mp4');
	const b = await uploadVideo(root, FOO, chunks(mp4()), a.version, deps);
	assert.equal(b.href, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-05.mp4');
	// The front matter is untouched: an mp4 has no `images` entry.
	assert.equal(postOf(root), POST);
	// A place doc numbers under today, in its own folder, and is never stamped.
	mkdirSync(join(root, PLACES_MD), { recursive: true });
	writeFileSync(join(root, PLACES_MD, 'foo.md'), '---\ntitle: Foo place\ndescription: A place.\n---\n');
	const place: DocRef = { kind: 'place', slug: 'foo' };
	const { loadPlace } = await import('./place-doc');
	const p = await uploadVideo(root, place, chunks(mp4()), loadPlace(root, 'foo').version, { ...deps, isTracked: () => true });
	assert.equal(p.href, '/images/projects/data-viz/hikes/places/foo/2026-10-29-00.mp4');
	assert.equal(p.stamped, false);
	assert.ok(existsSync(join(root, PLACE_IMAGES, 'foo', '2026-10-29-00.mp4')));
});

function counting(over: Partial<VideoFetcher> = {}): VideoFetcher & { calls: number } {
	const stub = createStubFetcher();
	const f: VideoFetcher & { calls: number } = {
		calls: 0,
		page: async (id: string): Promise<string> => (f.calls++, stub.page(id)),
		localized: (id: string, lang: string) => stub.localized(id, lang),
		thumbnail: (id: string) => stub.thumbnail(id),
		...over
	};
	return f;
}

test('youtube entry is written as a flow map with blur last', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	const fetcher = counting();
	const r = await addYoutube(root, FOO, `https://youtu.be/${VID}`, version(root), { fetcher });
	assert.equal(r.id, VID);
	assert.equal(typeof r.title, 'string');
	assert.equal(r.version, version(root));
	const raw = postOf(root);
	const line = raw.split('\n').find((l) => l.startsWith(`  ${VID}: `))!;
	assert.match(raw, new RegExp(`\\nvideos:\\n  ${VID}: \\{uploadDate: '2025-08-03T07:30:07-07:00', duration: PT36M42S, title: \\{en: `));
	assert.match(line, /, w: \d+, h: \d+, blur: 'data:image\/webp;base64,[^']+'\}$/);
	assert.equal(readFrontmatterDoc(raw).doc.toJS().videos[VID].title.en, r.title);
	assert.ok(existsSync(join(root, 'static/images/projects/data-viz/hikes/videos', `${VID}.jpg`)));
	// Complete with its poster: a no-op, YouTube is not asked again.
	const again = await addYoutube(root, FOO, `https://www.youtube.com/watch?v=${VID}`, r.version, { fetcher });
	assert.deepEqual(again, { id: VID, title: r.title, version: r.version });
	assert.equal(fetcher.calls, 1);
	assert.equal(postOf(root), raw);
	// A stale base is refused on the no-op path too (409 with the doc), so the client never adopts a version it hasn't seen.
	await assert.rejects(addYoutube(root, FOO, `https://youtu.be/${VID}`, 'stale', { fetcher }), (e) => e instanceof ApiError && e.status === 409 && 'fields' in e);
	assert.equal(fetcher.calls, 1);
	// A private video gets `{unavailable: true}`.
	const priv = await addYoutube(root, FOO, 'https://youtu.be/PrivateVid1', r.version, { fetcher });
	assert.deepEqual({ ...priv, version: undefined }, { id: 'PrivateVid1', title: null, version: undefined, unavailable: true });
	assert.match(postOf(root), /\n {2}PrivateVid1: \{unavailable: true\}\n---\n/);
	// A place doc has no `videos`.
	await assert.rejects(addYoutube(root, { kind: 'place', slug: 'foo' }, `https://youtu.be/${VID}`, 'x', { fetcher }), (e) => e instanceof ApiError && e.status === 400);
});

test('youtube entries of the real posts are spelled as written', () => {
	const dir = join(__dirname, '../../..', MD);
	let seen = 0;
	for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
		const raw = readFileSync(join(dir, f), 'utf8');
		if (!/\nvideos:\n/.test(raw)) continue;
		const { doc, body } = readFrontmatterDoc(raw);
		for (const [id, entry] of Object.entries(doc.toJS().videos as Record<string, Record<string, unknown>>)) setVideoEntry(doc, id, entry);
		assert.equal(writeFrontmatterDoc(doc, body), raw, f);
		seen++;
	}
	assert.ok(seen >= 3);
});

test('a stale base on youtube fetches and writes nothing', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	const fetcher = counting();
	await assert.rejects(addYoutube(root, FOO, `https://youtu.be/${VID}`, 'stale', { fetcher }), (e) => e instanceof ApiError && e.status === 409 && 'fields' in e);
	assert.equal(fetcher.calls, 0);
	assert.equal(existsSync(join(root, 'static/images/projects/data-viz/hikes/videos')), false);
	assert.equal(postOf(root), '---\ntitle: Foo\n---\nText.\n');
});

test('youtube offline writes nothing', async () => {
	const root = repo('---\ntitle: Foo\n---\nText.\n');
	const offline = counting({ page: async () => Promise.reject(new TypeError('fetch failed')) });
	await assert.rejects(addYoutube(root, FOO, `https://youtu.be/${VID}`, version(root), { fetcher: offline }), (e) => e instanceof ApiError && e.status === 502 && /YouTube unreachable/.test(e.message));
	assert.equal(postOf(root), '---\ntitle: Foo\n---\nText.\n');
	assert.equal(existsSync(join(root, 'static/images/projects/data-viz/hikes/videos')), false);
	await assert.rejects(addYoutube(root, FOO, 'https://vimeo.com/123', version(root), { fetcher: offline }), (e) => e instanceof ApiError && e.status === 400);
});

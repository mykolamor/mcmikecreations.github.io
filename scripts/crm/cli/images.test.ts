import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { repoPaths } from '../server/paths';
import { blogImages, images } from './images';
import { parseArgs } from './index';
import { recorder } from './test-output';

const STORIES = 'static/images/projects/data-viz/hikes/stories/foo';
const TOPO = 'static/images/hikes/topo';

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 140, b: 60 } } }).jpeg().toBuffer();

async function setup(body: string, front: string) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-images-'));
	const p = repoPaths(root);
	for (const d of [p.markdown, p.places, join(root, STORIES), join(root, TOPO)]) mkdirSync(d, { recursive: true });
	writeFileSync(join(root, STORIES, '2024-01-01-00.jpg'), await jpeg(1500, 1000));
	writeFileSync(join(root, STORIES, '2024-01-01-01.jpg'), await jpeg(800, 600));
	writeFileSync(join(root, TOPO, 'map.png'), await sharp({ create: { width: 700, height: 700, channels: 3, background: '#fff' } }).png().toBuffer());
	const post = join(p.markdown, '2024-01-01-foo.md');
	writeFileSync(post, `---\n${front}---\n${body}`);
	return { root, post };
}

const go = (root: string, argv: string[] = []) => {
	const out = recorder();
	return images.run(root, parseArgs(['images', ...argv]), out).then((code) => ({ code, out }));
};

const BODY = [
	'![a](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)',
	'',
	'![b](/images/projects/data-viz/hikes/stories/foo/2024-01-01-01.jpg)',
	'',
	'![map](/images/hikes/topo/map.png)',
	''
].join('\n');

test('images adds missing tiers and keeps existing fields', async () => {
	const front = "title: T # kept\nimages:\n  2024-01-01-00.jpg: {w: 1500, h: 1000, lat: 47.5, lon: 11.25, taken: '2024-01-01T10:00:00+01:00', alt: 'Hut'}\n";
	const { root, post } = await setup(BODY, front);
	// an existing tier is never re-encoded
	const kept = join(root, STORIES, '2024-01-01-00-640.avif');
	writeFileSync(kept, 'existing tier');

	const dry = await go(root, ['--dry-run']);
	assert.equal(dry.code, 0);
	assert.equal(dry.out.changes.length, 1);
	assert.equal(readFileSync(post, 'utf8'), `---\n${front}---\n${BODY}`);
	assert.ok(!existsSync(join(root, STORIES, '2024-01-01-00-1280.avif')));

	const { code, out } = await go(root);
	assert.equal(code, 0, out.warnings.join('\n'));
	assert.deepEqual(out.changes.map((c) => c.split(':')[0]), ['static/_projects/data-viz/hikes/markdown/2024-01-01-foo.md']);
	assert.equal(readFileSync(kept, 'utf8'), 'existing tier');
	for (const f of ['2024-01-01-00-1280.avif', '2024-01-01-01-640.avif']) assert.ok(existsSync(join(root, STORIES, f)), f);
	assert.ok(existsSync(join(root, TOPO, 'map-640.avif')));

	const lines = readFileSync(post, 'utf8').split('\n');
	assert.equal(lines[1], 'title: T # kept');
	assert.match(lines[3], /^ {2}2024-01-01-00\.jpg: \{w: 1500, h: 1000, lat: 47\.5, lon: 11\.25, taken: '2024-01-01T10:00:00\+01:00', blur: 'data:image\/webp;base64,[^']+', alt: 'Hut'\}$/);
	assert.match(lines[4], /^ {2}2024-01-01-01\.jpg: \{w: 800, h: 600, blur: 'data:image\/webp;base64,[^']+'\}$/);
	assert.match(lines[5], /^ {2}\/images\/hikes\/topo\/map\.png: \{w: 700, h: 700, blur: 'data:image\/webp;base64,[^']+'\}$/);

	const before = readFileSync(post, 'utf8');
	const again = await go(root);
	assert.equal(again.code, 0);
	assert.deepEqual(again.out.changes, []);
	assert.equal(readFileSync(post, 'utf8'), before);
});

test('images lists a missing source file and exits 0', async () => {
	// 08 is stored as AVIF tiers only (no original), as the Photos tab adds photos: complete, so not listed
	const body = '![gone](/images/projects/data-viz/hikes/stories/foo/2024-01-01-09.jpg)\n\n![tiers only](/images/projects/data-viz/hikes/stories/foo/2024-01-01-08.jpg)\n';
	const front = "title: T\nimages:\n  2024-01-01-08.jpg: {w: 800, h: 600, blur: 'data:x'}\n";
	const { root, post } = await setup(body, front);
	writeFileSync(join(root, STORIES, '2024-01-01-08-640.avif'), 'tier');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.deepEqual(out.changes, []);
	assert.ok(out.warnings.some((w) => w.includes('2024-01-01-foo.md') && w.includes('/images/projects/data-viz/hikes/stories/foo/2024-01-01-09.jpg')), out.warnings.join('\n'));
	assert.ok(!out.warnings.some((w) => w.includes('2024-01-01-08')), out.warnings.join('\n'));
	assert.match(out.summaries.join('\n'), /1 missing source\b/);
	assert.equal(readFileSync(post, 'utf8'), `---\n${front}---\n${body}`);
});

test('images covers an image only a translation shows', async () => {
	const { root, post } = await setup('Text only.\n', 'title: Foo\n');
	writeFileSync(join(repoPaths(root).markdown, '2024-01-01-foo.de.md'), '---\ntitle: Fuu\n---\n![a](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)\n');
	const { code, out } = await go(root);
	assert.equal(code, 0);
	assert.match(readFileSync(post, 'utf8'), /2024-01-01-00\.jpg: \{w: 1500, h: 1000/);
	assert.ok(existsSync(join(root, STORIES, '2024-01-01-00-640.avif')));
	assert.deepEqual(out.warnings, []);
});

async function setupBlog(post: string) {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-blog-images-'));
	const blog = join(root, 'static/_blog');
	const pics = join(root, 'static/images/blog/foo');
	const hikes = join(root, 'static/images/projects/data-viz/hikes');
	for (const d of [blog, pics, hikes]) mkdirSync(d, { recursive: true });
	writeFileSync(join(pics, 'shot.png'), await sharp({ create: { width: 900, height: 600, channels: 3, background: '#abc' } }).png().toBuffer());
	writeFileSync(join(pics, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
	writeFileSync(join(root, 'static/images/blog/foo.jpg'), await jpeg(1400, 700));
	writeFileSync(join(hikes, 'hero.jpg'), await jpeg(2000, 1000));
	const file = join(blog, '2024-01-01-foo.md');
	writeFileSync(file, post);
	// a translation is never a post of its own
	writeFileSync(join(blog, '2024-01-01-foo.de.md'), '---\ntitle: Fuu\n---\nText.\n');
	return { root, file, pics, hikes };
}

const goBlog = (root: string, argv: string[] = []) => {
	const out = recorder();
	return blogImages.run(root, parseArgs(['blog-images', ...argv]), out).then((code) => ({ code, out }));
};

test('blog-images covers image, imageFull and raster body images, never SVG, and is idempotent', async () => {
	const body = [
		'![Shot](/images/blog/foo/shot.png)',
		'',
		'![Diagram](/images/blog/foo/diagram.svg "invert")',
		'',
		'![Remote](https://example.com/x.jpg)',
		''
	].join('\n');
	const front = "title: Foo\ndate: '2024-01-01'\nimage: /images/blog/foo.jpg\nimageFull: /images/projects/data-viz/hikes/hero.jpg\n";
	const { root, file, pics, hikes } = await setupBlog(`---\n${front}---\n${body}`);
	// a borrowed hike photo's tier already on disk is reused
	writeFileSync(join(hikes, 'hero-640.avif'), 'existing tier');

	const { code, out } = await goBlog(root);
	assert.equal(code, 0, out.warnings.join('\n'));
	assert.deepEqual(out.changes.map((c) => c.split(':')[0]), ['static/_blog/2024-01-01-foo.md']);
	assert.equal(readFileSync(join(hikes, 'hero-640.avif'), 'utf8'), 'existing tier');
	for (const f of ['hero-1280.avif']) assert.ok(existsSync(join(hikes, f)), f);
	assert.ok(existsSync(join(pics, 'shot-640.avif')));
	assert.ok(!existsSync(join(pics, 'diagram-640.avif')));

	const text = readFileSync(file, 'utf8');
	assert.ok(text.endsWith(`---\n${body}`), 'body untouched');
	assert.match(text, /\n {2}\/images\/blog\/foo\.jpg: \{w: 1400, h: 700, blur: 'data:image\/webp;base64,[^']+'\}\n/);
	assert.match(text, /\n {2}\/images\/projects\/data-viz\/hikes\/hero\.jpg: \{w: 2000, h: 1000, blur: '[^']+'\}\n/);
	assert.match(text, /\n {2}\/images\/blog\/foo\/shot\.png: \{w: 900, h: 600, blur: '[^']+'\}\n/);
	assert.doesNotMatch(text, /diagram\.svg:/);

	const again = await goBlog(root);
	assert.equal(again.code, 0);
	assert.deepEqual(again.out.changes, []);
	assert.equal(readFileSync(file, 'utf8'), text);
});

test('blog-images keeps an existing alt-only entry and fills it in', async () => {
	const front = "title: Foo\nimages:\n  /images/blog/foo/shot.png: {alt: 'A screenshot'}\n";
	const { root, file } = await setupBlog(`---\n${front}---\n![Shot](/images/blog/foo/shot.png)\n`);
	const { code } = await goBlog(root);
	assert.equal(code, 0);
	assert.match(readFileSync(file, 'utf8'), /\/images\/blog\/foo\/shot\.png: \{w: 900, h: 600, blur: '[^']+', alt: 'A screenshot'\}/);
});

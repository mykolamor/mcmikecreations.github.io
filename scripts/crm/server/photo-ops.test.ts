import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { addFromImmich, addFromLibrary, addUpload, pinState, postPhotos, removePhoto, setAlt, setCaption, setLocation, setPins, setTime, StaleDocError } from './photo-ops';
import { loadDoc } from './doc';
import { readLinks, setLink } from './immich-links';
import { ApiError } from './errors';
import { ImmichUnreachableError, type Asset, type Immich } from './immich-client';
import type { DocRef } from './doc-ref';
import { loadPlace } from './place-doc';

const STORIES = 'static/images/projects/data-viz/hikes/stories';
const MD = 'static/_projects/data-viz/hikes/markdown';
const PLACES_MD = 'static/_projects/data-viz/hikes/places';
const PLACE_IMAGES = 'static/images/projects/data-viz/hikes/places';
const FOO: DocRef = { kind: 'post', slug: 'foo', date: '2024-01-01' };
const FOO_PLACE: DocRef = { kind: 'place', slug: 'foo' };

function repo(post: string, others: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), 'photo-ops-'));
	mkdirSync(join(root, MD), { recursive: true });
	writeFileSync(join(root, MD, 'foo.hike.json'), '{\n  "name": "Foo"\n}\n');
	writeFileSync(join(root, MD, '2024-01-01-foo.md'), post);
	for (const [f, raw] of Object.entries(others)) writeFileSync(join(root, MD, f), raw);
	return root;
}
const postOf = (root: string) => readFileSync(join(root, MD, '2024-01-01-foo.md'), 'utf8');
const version = (root: string) => loadDoc(root, 'foo', '2024-01-01').version;

async function jpeg(w = 3000, h = 2000): Promise<Buffer> {
	return sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 120, b: 200 } } }).jpeg().toBuffer();
}

function stubImmich(assets: Record<string, Partial<Asset>>): Immich & { downloads: number } {
	const s = {
		downloads: 0,
		albums: async () => [],
		search: async () => [],
		smart: async () => [],
		asset: async (id: string) => ({ id, fileName: `${id}.jpg`, takenLocal: '', width: 3000, height: 2000, ...assets[id] }) as Asset,
		thumb: async () => Buffer.alloc(0),
		original: async (id: string) => {
			s.downloads++;
			return { bytes: await jpeg(), fileName: `${id}.jpg` };
		},
		update: async () => {
			throw new Error('no writes in tests');
		}
	};
	return s;
}
const deps = (immich: Immich) => ({ immich, terrain: { height: () => 1371.3 }, isTracked: () => false });

const POST = `---
title: Foo
images:
  2024-01-01-00.jpg: {w: 10, h: 10, blur: 'data:x'}
  2024-01-01-03.jpg: {w: 10, h: 10, blur: 'data:y'}
---
Body text.

![First](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)
`;

test('adds tiers but never the original', async () => {
	const root = repo(POST);
	const r = await addFromImmich(root, FOO, 'a1', version(root), deps(stubImmich({ a1: {} })));
	assert.equal(r.key, '2024-01-01-04.jpg');
	assert.deepEqual(readdirSync(join(root, STORIES, 'foo')).sort(), ['2024-01-01-04-1280.avif', '2024-01-01-04-2560.avif', '2024-01-01-04-640.avif']);
	assert.equal(r.version, version(root));
});

test('numbers continue after the highest existing NN', async () => {
	const root = repo(POST);
	// a tier file of a removed entry still holds number 07
	mkdirSync(join(root, STORIES, 'foo'), { recursive: true });
	writeFileSync(join(root, STORIES, 'foo', '2024-01-01-07-640.avif'), 'x');
	writeFileSync(join(root, STORIES, 'foo', '2023-05-05-12-640.avif'), 'x'); // another date's number does not count
	const r = await addFromImmich(root, FOO, 'a1', version(root), deps(stubImmich({ a1: {} })));
	assert.equal(r.key, '2024-01-01-08.jpg');
});

test('adding an asset already in the post is a no-op returning its key', async () => {
	const root = repo(POST);
	const immich = stubImmich({ a1: {} });
	const first = await addFromImmich(root, FOO, 'a1', version(root), deps(immich));
	const before = postOf(root);
	const again = await addFromImmich(root, FOO, 'a1', first.version, deps(immich));
	assert.equal(again.key, first.key);
	assert.equal(again.version, first.version);
	assert.equal(postOf(root), before);
	assert.equal(immich.downloads, 1);
	// a second device with the old base is still answered with the key, not a 409 or a second number
	const stale = await addFromImmich(root, FOO, 'a1', 'old-version', deps(immich));
	assert.equal(stale.key, first.key);
	assert.deepEqual(readLinks(root)['2024-01-01-foo.md'], { [first.key]: 'a1' });
});

test('a failed link write after the entry is committed still returns the result, with linkError', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, async () => {
	const root = repo(POST);
	const data = join(root, 'scripts/crm/data');
	mkdirSync(data, { recursive: true });
	chmodSync(data, 0o555); // immich-links.json can be read (absent) but not written
	try {
		const r = await addFromImmich(root, FOO, 'a1', version(root), deps(stubImmich({ a1: {} })));
		assert.equal(r.key, '2024-01-01-04.jpg');
		assert.match(postOf(root), /2024-01-01-04\.jpg: \{w: 3000/);
		assert.equal(r.version, version(root));
		assert.match(r.linkError ?? '', /EACCES|permission/i);
	} finally {
		chmodSync(data, 0o755);
	}
});

test('entry fields in writer order with taken offset', async () => {
	const root = repo(POST);
	const immich = stubImmich({ a1: { takenLocal: '2024-01-01T11:18:16+02:00', lat: 47.12345678, lon: 11.7654321 } });
	const r = await addFromImmich(root, FOO, 'a1', version(root), deps(immich));
	const line = postOf(root).split('\n').find((l) => l.startsWith(`  ${r.key}:`))!;
	assert.match(line, /^ {2}2024-01-01-04\.jpg: \{w: 3000, h: 2000, lat: 47\.123457, lon: 11\.765432, demEle: 1371\.3, taken: '2024-01-01T11:18:16\+02:00', blur: 'data:image\/webp;base64,[A-Za-z0-9+/=]+'\}$/);
	// the entry is appended after the existing ones, the rest of the file is untouched
	assert.equal(postOf(root).replace(line + '\n', ''), POST);
});

test('a whole-metre demEle is written as a float like the old pipeline', async () => {
	const root = repo(POST);
	const immich = stubImmich({ a1: { lat: 47.5, lon: 11.5 } });
	await addFromImmich(root, FOO, 'a1', version(root), { ...deps(immich), terrain: { height: () => 1086 } });
	assert.match(postOf(root), /lat: 47\.5, lon: 11\.5, demEle: 1086\.0, blur: /);
});

test('stale base is refused with the current doc', async () => {
	const root = repo(POST);
	await assert.rejects(addFromImmich(root, FOO, 'a1', 'nope', deps(stubImmich({ a1: {} }))), (e) => e instanceof StaleDocError && e.status === 409);
	assert.equal(postOf(root), POST);
	assert.equal(existsSync(join(root, STORIES, 'foo')), false);
});

test('remove refuses when the markdown references the key', async () => {
	const root = repo(POST);
	await assert.rejects(removePhoto(root, FOO, '2024-01-01-00.jpg', version(root), { isTracked: () => false }), (e) => e instanceof ApiError && e.status === 409 && e.message === 'used in the text — remove it in Write first');
	assert.equal(postOf(root), POST);
});

test('remove deletes tiers only when no other post uses them', async () => {
	const shared = '/images/hikes/topo/x.jpg';
	const root = repo(POST.replace("images:\n", `images:\n  ${shared}: {w: 10, h: 10, blur: 'data:z'}\n`), {
		'2024-02-02-bar.md': `---\ntitle: Bar\nimages:\n  ${shared}: {w: 10, h: 10, blur: 'data:z'}\n---\nText\n`
	});
	const own = join(root, STORIES, 'foo');
	const topo = join(root, 'static/images/hikes/topo');
	mkdirSync(own, { recursive: true });
	mkdirSync(topo, { recursive: true });
	for (const t of [640, 1280]) {
		writeFileSync(join(own, `2024-01-01-03-${t}.avif`), 'x');
		writeFileSync(join(topo, `x-${t}.avif`), 'x');
	}
	writeFileSync(join(topo, 'x.jpg'), 'original');
	await setLink(root, '2024-01-01-foo.md', '2024-01-01-03.jpg', 'a3');

	const r1 = await removePhoto(root, FOO, '2024-01-01-03.jpg', version(root), { isTracked: () => false });
	assert.equal(r1.version, version(root));
	assert.doesNotMatch(postOf(root), /2024-01-01-03\.jpg/);
	assert.deepEqual(readdirSync(own), []);
	assert.equal(readLinks(root)['2024-01-01-foo.md'], undefined);

	await removePhoto(root, FOO, shared, version(root), { isTracked: () => false });
	assert.doesNotMatch(postOf(root), /topo/);
	assert.deepEqual(readdirSync(topo).sort(), ['x-1280.avif', 'x-640.avif', 'x.jpg'], 'bar still uses the topo');
});

test('remove never deletes tiers of library images outside the stories tree', async () => {
	const lib = '/images/projects/other/x.jpg';
	const topoHref = '/images/hikes/topo/t.jpg';
	const root = repo(POST.replace("images:\n", `images:\n  ${lib}: {w: 10, h: 10, blur: 'data:z'}\n  ${topoHref}: {w: 10, h: 10, blur: 'data:t'}\n`));
	const other = join(root, 'static/images/projects/other');
	const topo = join(root, 'static/images/hikes/topo');
	mkdirSync(other, { recursive: true });
	mkdirSync(topo, { recursive: true });
	for (const t of [640, 1280]) {
		writeFileSync(join(other, `x-${t}.avif`), 'x');
		writeFileSync(join(topo, `t-${t}.avif`), 'x');
	}
	const r = await removePhoto(root, FOO, lib, version(root), { isTracked: () => false });
	assert.equal(r.tiersRemoved, false);
	await removePhoto(root, FOO, topoHref, version(root), { isTracked: () => false });
	assert.doesNotMatch(postOf(root), /other|topo/);
	assert.deepEqual(readdirSync(other).sort(), ['x-1280.avif', 'x-640.avif']);
	assert.deepEqual(readdirSync(topo).sort(), ['t-1280.avif', 't-640.avif']);
});

test('remove keeps tiers a place doc references in its markdown', async () => {
	const root = repo(POST);
	mkdirSync(join(root, 'static/_projects/data-viz/hikes/places'), { recursive: true });
	writeFileSync(join(root, 'static/_projects/data-viz/hikes/places/hut.md'), '---\nname: Hut\n---\n![Hut](/images/projects/data-viz/hikes/stories/foo/2024-01-01-03.jpg)\n');
	const own = join(root, STORIES, 'foo');
	mkdirSync(own, { recursive: true });
	writeFileSync(join(own, '2024-01-01-03-640.avif'), 'x');
	await removePhoto(root, FOO, '2024-01-01-03.jpg', version(root), { isTracked: () => false });
	assert.deepEqual(readdirSync(own), ['2024-01-01-03-640.avif']);
});

const DE_PHOTO = '![Foto](/images/projects/data-viz/hikes/stories/foo/2024-01-01-03.jpg)\n';

test('remove refuses a photo used only in a translation', async () => {
	const root = repo(POST, { '2024-01-01-foo.de.md': `---\ntitle: Fuu\n---\n${DE_PHOTO}` });
	await assert.rejects(removePhoto(root, FOO, '2024-01-01-03.jpg', version(root), { isTracked: () => false }), (e) => e instanceof ApiError && e.status === 409 && e.message === 'used in the text — remove it in Write first');
	assert.match(postOf(root), /2024-01-01-03\.jpg/);
	const photo = postPhotos(root, FOO).find((x) => x.key === '2024-01-01-03.jpg');
	assert.equal(photo?.inText, true);
});

test('tiers aren\'t deleted while a translation uses the photo', async () => {
	const root = repo(POST);
	const places = join(root, PLACES_MD);
	mkdirSync(places, { recursive: true });
	writeFileSync(join(places, 'hut.md'), '---\ntitle: Hut\ndescription: A hut.\n---\nText.\n');
	writeFileSync(join(places, 'hut.de.md'), `---\ntitle: Hütte\n---\n${DE_PHOTO}`);
	const own = join(root, STORIES, 'foo');
	mkdirSync(own, { recursive: true });
	writeFileSync(join(own, '2024-01-01-03-640.avif'), 'x');
	const r = await removePhoto(root, FOO, '2024-01-01-03.jpg', version(root), { isTracked: () => false });
	assert.equal(r.tiersRemoved, false);
	assert.deepEqual(readdirSync(own), ['2024-01-01-03-640.avif']);
});

test('remove of an unknown key is 404', async () => {
	const root = repo(POST);
	await assert.rejects(removePhoto(root, FOO, '2024-01-01-99.jpg', version(root), { isTracked: () => false }), (e) => e instanceof ApiError && e.status === 404);
});

test('upload to topo gets a full-href key', async () => {
	const root = repo(POST);
	const r = await addUpload(root, FOO, await jpeg(1754, 1240), 'My Topo.PNG', { target: 'topo', credit: 'Alpenverein', sourceUrl: 'https://example.org/t' }, version(root), { isTracked: () => false });
	assert.equal(r.key, '/images/hikes/topo/my-topo.png');
	assert.equal(r.href, r.key);
	assert.equal(r.caption, 'by [Alpenverein](https://example.org/t)');
	assert.deepEqual(readdirSync(join(root, 'static/images/hikes/topo')).sort(), ['my-topo-1280.avif', 'my-topo-640.avif']);
	assert.match(postOf(root), /\n {2}\/images\/hikes\/topo\/my-topo\.png: \{w: 1754, h: 1240, blur: 'data:image\/webp;base64,/);
	// the same name again never overwrites: it gets a suffix
	const again = await addUpload(root, FOO, await jpeg(800, 600), 'my-topo.png', { target: 'topo', sourceUrl: 'https://www.bbc.com/x' }, r.version, { isTracked: () => false });
	assert.equal(again.key, '/images/hikes/topo/my-topo-2.png');
	assert.equal(again.caption, 'Credit: [bbc.com](https://www.bbc.com/x)');
});

test('upload with credit appends the credit and image lines', async () => {
	const root = repo(POST);
	const r = await addUpload(root, FOO, await jpeg(1754, 1240), 'Map.png', { target: 'topo', credit: 'Alpenverein', sourceUrl: 'https://example.org/t' }, version(root), { isTracked: () => false });
	assert.equal(r.caption, 'by [Alpenverein](https://example.org/t)');
	const after = postOf(root);
	// one locked write: the entry and the two lines, the body otherwise untouched
	assert.ok(after.endsWith(POST.slice(POST.indexOf('\n---\n') + 5) + '\nby [Alpenverein](https://example.org/t)\n![](/images/hikes/topo/map.png)\n'), after);
	assert.match(after, /\n {2}\/images\/hikes\/topo\/map\.png: \{w: 1754/);
	assert.equal(r.version, version(root));
	// a body without a trailing newline still gets a blank line before the credit
	const bare = repo(POST.replace(/\n$/, ''));
	await addUpload(bare, FOO, await jpeg(800, 600), 'x.jpg', { target: 'topo', credit: 'Me' }, version(bare), { isTracked: () => false });
	assert.ok(postOf(bare).endsWith('\n\nby Me\n![](/images/hikes/topo/x.jpg)\n'), postOf(bare));
	// without a credit nothing is appended
	const plain = repo(POST);
	await addUpload(plain, FOO, await jpeg(800, 600), 'y.jpg', { target: 'topo' }, version(plain), { isTracked: () => false });
	assert.ok(postOf(plain).endsWith(POST.slice(POST.indexOf('\n---\n') + 5)));
});

test('upload to stories gets the next bare NN key', async () => {
	const root = repo(POST);
	const r = await addUpload(root, FOO, await jpeg(), 'IMG_1.jpg', { target: 'stories' }, version(root), { isTracked: () => false });
	assert.equal(r.key, '2024-01-01-04.jpg');
	assert.equal(r.href, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-04.jpg');
	assert.equal(r.caption, undefined);
});

test('upload refuses a target outside static/images and a too-small image', async () => {
	const root = repo(POST);
	const v = version(root);
	await assert.rejects(addUpload(root, FOO, await jpeg(), 'a.jpg', { target: 'images/../../x' }, v), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(addUpload(root, FOO, await jpeg(), 'a.jpg', { target: '_projects/x' }, v), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(addUpload(root, FOO, await jpeg(400, 300), 'a.jpg', { target: 'topo' }, v), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(addUpload(root, FOO, Buffer.from('nope'), 'a.jpg', { target: 'topo' }, v), (e) => e instanceof ApiError && e.status === 400);
	assert.equal(postOf(root), POST);
});

test('library add encodes missing tiers next to the file and keys by full href', async () => {
	const root = repo(POST);
	const topo = join(root, 'static/images/hikes/topo');
	mkdirSync(topo, { recursive: true });
	await sharp(await jpeg(1240, 1754)).toFile(join(topo, 'buch.jpg'));
	const r = await addFromLibrary(root, FOO, '/images/hikes/topo/buch.jpg', version(root), { isTracked: () => false });
	assert.equal(r.key, '/images/hikes/topo/buch.jpg');
	assert.deepEqual(readdirSync(topo).sort(), ['buch-1280.avif', 'buch-640.avif', 'buch.jpg']);
	assert.match(postOf(root), /\n {2}\/images\/hikes\/topo\/buch\.jpg: \{w: 1240, h: 1754, blur: 'data:image\/webp;base64,/);
	const again = await addFromLibrary(root, FOO, '/images/hikes/topo/buch.jpg', r.version, { isTracked: () => false });
	assert.equal(again.version, r.version);
	await assert.rejects(addFromLibrary(root, FOO, '/images/../_projects/x.jpg', r.version), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(addFromLibrary(root, FOO, '/images/hikes/topo/none.jpg', r.version), (e) => e instanceof ApiError && e.status === 404);
});

test('add and remove stamp updated on a tracked post and report the previous value', async () => {
	const root = repo(POST.replace('title: Foo\n', 'title: Foo\nupdated: 2023-03-03\n'));
	const today = '2030-01-02';
	const r = await addFromImmich(root, FOO, 'a1', version(root), { ...deps(stubImmich({ a1: {} })), isTracked: () => true, today: () => today });
	assert.deepEqual([r.stamped, r.previous], [true, '2023-03-03']);
	assert.match(postOf(root), /\nupdated: 2030-01-02\n/);
	assert.equal(r.version, version(root));
	const rm = await removePhoto(root, FOO, r.key, r.version, { isTracked: () => true, today: () => today });
	assert.equal(rm.stamped, false);
});

test('library reuses a tier-only story photo by copying the entry that describes it', async () => {
	const other = `---\ntitle: Bar\nimages:\n  2023-05-05-02.jpg: {w: 8160, h: 6120, lat: 47.1, lon: 11.2, demEle: 1086.0, taken: '2023-05-05T10:00:00+02:00', located: track, blur: 'data:b', pins: [{ref: node/1, x: 0.5, y: 0.5}]}\n---\nText\n`;
	const root = repo(POST, { '2023-05-05-bar.md': other });
	const bar = join(root, STORIES, 'bar');
	mkdirSync(bar, { recursive: true });
	for (const t of [640, 1280, 2560]) writeFileSync(join(bar, `2023-05-05-02-${t}.avif`), 'x');
	const href = '/images/projects/data-viz/hikes/stories/bar/2023-05-05-02.jpg';
	const r = await addFromLibrary(root, FOO, href, version(root), { isTracked: () => false });
	assert.equal(r.key, href);
	const line = postOf(root).split('\n').find((l) => l.startsWith(`  ${href}:`));
	assert.equal(line, `  ${href}: {w: 8160, h: 6120, lat: 47.1, lon: 11.2, demEle: 1086.0, taken: '2023-05-05T10:00:00+02:00', located: track, blur: 'data:b'}`);
	assert.deepEqual(readdirSync(bar).sort(), ['2023-05-05-02-1280.avif', '2023-05-05-02-2560.avif', '2023-05-05-02-640.avif']);

	// tiers that no entry describes: 422; no tiers at all: 404
	writeFileSync(join(bar, '2023-05-05-09-640.avif'), 'x');
	await assert.rejects(addFromLibrary(root, FOO, '/images/projects/data-viz/hikes/stories/bar/2023-05-05-09.jpg', r.version), (e) => e instanceof ApiError && e.status === 422);
	await assert.rejects(addFromLibrary(root, FOO, '/images/projects/data-viz/hikes/stories/bar/2023-05-05-10.jpg', r.version), (e) => e instanceof ApiError && e.status === 404);
});

async function exifJpeg(exif: { taken?: string; offset?: string; gps?: boolean }): Promise<Buffer> {
	const IFD2: Record<string, string> = {};
	if (exif.taken) IFD2.DateTimeOriginal = exif.taken;
	if (exif.offset) IFD2.OffsetTimeOriginal = exif.offset;
	const IFD3 = exif.gps ? { GPSLatitudeRef: 'N', GPSLatitude: '47/1 30/1 1234/100', GPSLongitudeRef: 'E', GPSLongitude: '11/1 45/1 0/1' } : undefined;
	return sharp({ create: { width: 1000, height: 800, channels: 3, background: '#468' } })
		.withExif({ IFD0: { Make: 'Test' }, IFD2, ...(IFD3 ? { IFD3 } : {}) })
		.jpeg()
		.toBuffer();
}

test('stories upload keeps EXIF time with offset and GPS; shared targets do not', async () => {
	const root = repo(POST);
	const d = { isTracked: () => false, terrain: { height: () => 900 } };
	const file = await exifJpeg({ taken: '2024:01:01 11:18:16', offset: '+02:00', gps: true });
	const r = await addUpload(root, FOO, file, 'IMG.jpg', { target: 'stories' }, version(root), d);
	const line = postOf(root).split('\n').find((l) => l.startsWith(`  ${r.key}:`))!;
	assert.match(line, /^ {2}2024-01-01-04\.jpg: \{w: 1000, h: 800, lat: 47\.503428, lon: 11\.75, demEle: 900\.0, taken: '2024-01-01T11:18:16\+02:00', blur: '/);

	const noOffset = await addUpload(root, FOO, await exifJpeg({ taken: '2024:01:01 12:00:00' }), 'b.jpg', { target: 'stories' }, r.version, d);
	assert.match(postOf(root), new RegExp(`  ${noOffset.key}: \\{w: 1000, h: 800, blur: '`));

	const topo = await addUpload(root, FOO, file, 't.jpg', { target: 'topo' }, noOffset.version, d);
	assert.match(postOf(root), new RegExp(`  ${topo.key.replace(/[./]/g, '\\$&')}: \\{w: 1000, h: 800, blur: '`));
});

test('remove keeps tiers a visit post of the same hike references by bare key', async () => {
	const root = repo(POST, { '2024-06-06-foo.md': `---\ntitle: Visit\nimages:\n  2024-01-01-03.jpg: {w: 10, h: 10}\n---\nText\n` });
	const own = join(root, STORIES, 'foo');
	mkdirSync(own, { recursive: true });
	writeFileSync(join(own, '2024-01-01-03-640.avif'), 'x');
	const r = await removePhoto(root, FOO, '2024-01-01-03.jpg', version(root), { isTracked: () => false });
	assert.equal(r.tiersRemoved, false);
	assert.deepEqual(readdirSync(own), ['2024-01-01-03-640.avif']);
});

test('two concurrent adds with the same base: one wins, the other is a 409', async () => {
	const root = repo(POST);
	const immich = stubImmich({ a1: {}, a2: {} });
	const v = version(root);
	const res = await Promise.allSettled([addFromImmich(root, FOO, 'a1', v, deps(immich)), addFromImmich(root, FOO, 'a2', v, deps(immich))]);
	assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
	const lost = res.find((x) => x.status === 'rejected') as PromiseRejectedResult;
	assert.ok(lost.reason instanceof StaleDocError);
	assert.equal(readdirSync(join(root, STORIES, 'foo')).length, 3, 'only the winner wrote tiers');
});

// ---------------------------------------------------------------- fixes

const FIX = `---
title: Foo
gpx: /_projects/data-viz/hikes/gpx/foo.gpx
images:
  a.jpg: {w: 10, h: 10, lat: 47.1, lon: 11.1, demEle: 900.0, taken: '2024-01-01T11:18:16+02:00', blur: 'data:a'}
  b.jpg: {w: 10, h: 10, taken: '2024-01-01T10:00:00+01:00', blur: 'data:b'}
  c.jpg: {w: 10, h: 10, blur: 'data:c'}
---
Body.
`;
const GPX = `<gpx><trk><trkseg>
<trkpt lat="47.0" lon="11.0"><time>2024-01-01T09:00:00Z</time></trkpt>
<trkpt lat="47.01" lon="11.02"><time>2024-01-01T09:10:00Z</time></trkpt>
</trkseg></trk></gpx>`;
function fixRepo(withGpx = true): string {
	const root = repo(FIX);
	if (withGpx) {
		mkdirSync(join(root, 'static/_projects/data-viz/hikes/gpx'), { recursive: true });
		writeFileSync(join(root, 'static/_projects/data-viz/hikes/gpx/foo.gpx'), GPX);
	}
	return root;
}
const entryLine = (root: string, key: string) => postOf(root).split('\n').find((l) => l.startsWith(`  ${key}:`))!;
function recorder(fail = false): Immich & { calls: [string, unknown][] } {
	const s = stubImmich({});
	const calls: [string, unknown][] = [];
	return Object.assign(s, {
		calls,
		update: async (id: string, patch: unknown) => {
			calls.push([id, patch]);
			if (fail) throw new Error('immich down');
		}
	});
}

test('shift keeps each photo\'s UTC offset and skips untimed ones', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const im = recorder();
	const r = await setTime(root, FOO, ['a.jpg', 'b.jpg', 'c.jpg'], { shiftMinutes: 90 }, version(root), { immich: im });
	assert.deepEqual(r.skipped, ['c.jpg']);
	assert.deepEqual(r.immichErrors, []);
	assert.match(entryLine(root, 'a.jpg'), /taken: '2024-01-01T12:48:16\+02:00'/);
	assert.match(entryLine(root, 'b.jpg'), /taken: '2024-01-01T11:30:00\+01:00'/);
	assert.equal(entryLine(root, 'c.jpg'), "  c.jpg: {w: 10, h: 10, blur: 'data:c'}");
	assert.deepEqual(im.calls, [['A', { dateTimeOriginal: '2024-01-01T12:48:16.000+02:00' }]]);
	assert.equal(r.version, version(root));
});

test('shift crosses midnight on the photo\'s own wall clock', async () => {
	const root = fixRepo();
	await setTime(root, FOO, ['b.jpg'], { shiftMinutes: 14 * 60 }, version(root));
	assert.match(entryLine(root, 'b.jpg'), /taken: '2024-01-02T00:00:00\+01:00'/);
});

test('setting taken directly also works for an untimed photo', async () => {
	const root = fixRepo();
	const r = await setTime(root, FOO, ['c.jpg'], { taken: '2024-01-01T09:30:00+01:00' }, version(root));
	assert.deepEqual(r.skipped, []);
	assert.match(entryLine(root, 'c.jpg'), /\{w: 10, h: 10, taken: '2024-01-01T09:30:00\+01:00', blur: 'data:c'\}/);
	await assert.rejects(setTime(root, FOO, ['c.jpg'], { taken: 'yesterday' }, version(root)), (e) => e instanceof ApiError && e.status === 400);
});

test('fromTrack interpolates between trackpoints and marks located: track', async () => {
	const root = fixRepo();
	const im = recorder();
	// 11:05+02:00 = 09:05Z, halfway between the two points
	await setTime(root, FOO, ['c.jpg'], { taken: '2024-01-01T11:05:00+02:00' }, version(root));
	const r = await setLocation(root, FOO, 'c.jpg', { fromTrack: true }, version(root), { immich: im, terrain: { height: () => 1371.3 } });
	assert.match(entryLine(root, 'c.jpg'), /\{w: 10, h: 10, lat: 47\.005, lon: 11\.01, demEle: 1371\.3, taken: '2024-01-01T11:05:00\+02:00', located: track, blur: 'data:c'\}/);
	assert.deepEqual(im.calls, []);
	assert.deepEqual(r.immichErrors, []);
});

test('fromTrack needs a recording and a taken time', async () => {
	const noGpx = fixRepo(false);
	await assert.rejects(setLocation(noGpx, FOO, 'a.jpg', { fromTrack: true }, version(noGpx)), (e) => e instanceof ApiError && e.status === 422);
	const root = fixRepo();
	await assert.rejects(setLocation(root, FOO, 'c.jpg', { fromTrack: true }, version(root)), (e) => e instanceof ApiError && e.status === 422);
	assert.equal(postOf(root), FIX);
});

test('a real position drops located, recomputes demEle and is written back to Immich', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const im = recorder();
	await setLocation(root, FOO, 'a.jpg', { lat: 47.123456789, lon: 11.5 }, version(root), { immich: im, terrain: { height: () => 1371.3 } });
	assert.match(entryLine(root, 'a.jpg'), /\{w: 10, h: 10, lat: 47\.123457, lon: 11\.5, demEle: 1371\.3, taken: '2024-01-01T11:18:16\+02:00', blur: 'data:a'\}/);
	assert.deepEqual(im.calls, [['A', { latitude: 47.123457, longitude: 11.5 }]]);
});

test('drop location removes lat, lon, demEle, located', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const im = recorder();
	const r = await setLocation(root, FOO, 'a.jpg', null, version(root), { immich: im });
	assert.equal(entryLine(root, 'a.jpg'), "  a.jpg: {w: 10, h: 10, taken: '2024-01-01T11:18:16+02:00', blur: 'data:a'}");
	assert.equal(r.note, 'Immich keeps its location');
	assert.deepEqual(im.calls, []);
});

test('immich write-back failure is reported, front matter still written', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const r = await setTime(root, FOO, ['a.jpg'], { shiftMinutes: 5 }, version(root), { immich: recorder(true) });
	assert.deepEqual(r.immichErrors, [{ key: 'a.jpg', message: 'immich down' }]);
	assert.match(entryLine(root, 'a.jpg'), /taken: '2024-01-01T11:23:16\+02:00'/);
});

test('the returned version is the one written under the lock, not a later external write', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const im = Object.assign(recorder(), {
		update: async () => {
			// another editor saves the post while the write-back is in flight
			writeFileSync(join(root, MD, '2024-01-01-foo.md'), postOf(root) + 'External edit.\n');
		}
	});
	const t = await setTime(root, FOO, ['a.jpg'], { shiftMinutes: 5 }, version(root), { immich: im });
	assert.notEqual(t.version, version(root), 'setTime must not absorb the external write');
	const v = version(root);
	const l = await setLocation(root, FOO, 'a.jpg', { lat: 47.2, lon: 11.2 }, v, { immich: im, terrain: { height: () => 1 } });
	assert.notEqual(l.version, version(root), 'setLocation must not absorb the external write');
});

test('after an unreachable Immich the remaining write-backs are skipped with the same message', async () => {
	const root = fixRepo();
	for (const k of ['a.jpg', 'b.jpg', 'c.jpg']) await setLink(root, '2024-01-01-foo.md', k, k.toUpperCase());
	const im = recorder();
	im.update = async (id: string, patch: unknown) => {
		im.calls.push([id, patch]);
		throw new ImmichUnreachableError(true);
	};
	const r = await setTime(root, FOO, ['a.jpg', 'b.jpg', 'c.jpg'], { taken: '2024-01-01T10:00:00+01:00' }, version(root), { immich: im });
	assert.equal(im.calls.length, 1);
	assert.deepEqual(r.immichErrors, ['a.jpg', 'b.jpg', 'c.jpg'].map((key) => ({ key, message: 'Immich unreachable (timeout)' })));
	// a raw network failure (fetch's TypeError) counts too; an HTTP 4xx/5xx answer does not stop the rest
	const im2 = recorder();
	im2.update = async (id: string, patch: unknown) => {
		im2.calls.push([id, patch]);
		throw new TypeError('fetch failed');
	};
	const r2 = await setTime(root, FOO, ['a.jpg', 'b.jpg'], { shiftMinutes: 1 }, version(root), { immich: im2 });
	assert.equal(im2.calls.length, 1);
	assert.deepEqual(r2.immichErrors.map((e) => e.message), ['fetch failed', 'fetch failed']);
	const im3 = recorder();
	im3.update = async (id: string, patch: unknown) => {
		im3.calls.push([id, patch]);
		throw new ApiError(502, 'Immich PUT /api/assets: HTTP 400');
	};
	await setTime(root, FOO, ['a.jpg', 'b.jpg'], { shiftMinutes: 1 }, version(root), { immich: im3 });
	assert.equal(im3.calls.length, 2);
});

test('alt is written last and removed with null; stale base refused', async () => {
	const root = fixRepo();
	const v = version(root);
	const r = await setAlt(root, FOO, 'a.jpg', "Ridge at dawn, it's cold", v);
	assert.match(entryLine(root, 'a.jpg'), /blur: 'data:a', alt: 'Ridge at dawn, it''s cold'\}$/);
	await assert.rejects(setAlt(root, FOO, 'a.jpg', 'x', v), (e) => e instanceof StaleDocError);
	await setAlt(root, FOO, 'a.jpg', null, r.version);
	assert.doesNotMatch(postOf(root), /alt:/);
});

test('a linked photo without an Immich client reports it, front matter still written', async () => {
	const root = fixRepo();
	await setLink(root, '2024-01-01-foo.md', 'a.jpg', 'A');
	const r = await setTime(root, FOO, ['a.jpg', 'b.jpg'], { shiftMinutes: 5 }, version(root));
	assert.deepEqual(r.immichErrors, [{ key: 'a.jpg', message: 'Immich not configured — not written back' }]);
	assert.match(entryLine(root, 'a.jpg'), /taken: '2024-01-01T11:23:16\+02:00'/);
});

test('shiftMinutes is bounded to 7 days', async () => {
	const root = fixRepo();
	await assert.rejects(setTime(root, FOO, ['a.jpg'], { shiftMinutes: 7 * 24 * 60 + 1 }, version(root)), (e) => e instanceof ApiError && e.status === 400);
});

test('postPhotos lists the entries in order with link, placed-in-text, pin count and fields', async () => {
	const root = repo(`---
title: Foo
images:
  2024-01-01-00.jpg: {w: 10, h: 20, lat: 47.1, lon: 11.2, taken: '2024-01-01T10:00:00+01:00', located: track, blur: 'data:x', pins: [{ref: node/1, x: 0.1, y: 0.2}, {ref: node/2, x: 0.3, y: 0.4}], alt: A hut}
  /images/hikes/topo/buch.jpg: {w: 5, h: 6}
  2024-01-01-03.jpg: {w: 1, h: 1}
---
![First](/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg)
![Topo](/images/hikes/topo/buch.jpg)
`);
	await setLink(root, '2024-01-01-foo.md', '2024-01-01-03.jpg', 'asset-3');
	assert.deepEqual(postPhotos(root, FOO), [
		{ key: '2024-01-01-00.jpg', href: '/images/projects/data-viz/hikes/stories/foo/2024-01-01-00.jpg', assetId: null, inText: true, pins: 2, w: 10, h: 20, lat: 47.1, lon: 11.2, taken: '2024-01-01T10:00:00+01:00', located: 'track', alt: 'A hut' },
		{ key: '/images/hikes/topo/buch.jpg', href: '/images/hikes/topo/buch.jpg', assetId: null, inText: true, pins: 0, w: 5, h: 6 },
		{ key: '2024-01-01-03.jpg', href: '/images/projects/data-viz/hikes/stories/foo/2024-01-01-03.jpg', assetId: 'asset-3', inText: false, pins: 0, w: 1, h: 1 }
	]);
	assert.deepEqual(postPhotos(repo('---\ntitle: Foo\n---\nBody\n'), FOO), []);
	assert.throws(() => postPhotos(root, { kind: 'post', slug: 'foo', date: '2024-09-09' }), (e) => e instanceof ApiError && e.status === 404);
});

// ---------------------------------------------------------------- pins and caption

const OSM = 'static/_projects/data-viz/hikes/osm.json';
const PIN_POST = `---
title: Foo
images:
  a.jpg: {w: 10, h: 10, blur: 'data:a', pinsReview: true}
  b.jpg: {w: 10, h: 10, blur: 'data:b'}
  /images/hikes/topo/t.jpg: {w: 5, h: 5}
---
Intro text mentioning [a link](https://example.com/a.jpg).

![Old caption with [credit](https://x.example)](/images/projects/data-viz/hikes/stories/foo/a.jpg)

More text.

![Topo](/images/hikes/topo/t.jpg)
![Twice](/images/projects/data-viz/hikes/stories/foo/c.jpg)
![Twice again](/images/projects/data-viz/hikes/stories/foo/c.jpg)
`;
function pinRepo(post = PIN_POST): string {
	const root = repo(post);
	writeFileSync(join(root, OSM), JSON.stringify({ 'node/1': { lat: 47.1, lon: 11.1, tags: { name: 'Wallberg', ele: '1722' } }, 'way/2': { lat: 47.2, lon: 11.2, tags: { name: 'Setzberg' } } }, null, 2) + '\n');
	return root;
}

test('setPins rejects refs missing from osm.json', async () => {
	const root = pinRepo();
	const v = version(root);
	await assert.rejects(setPins(root, FOO, 'b.jpg', [{ ref: 'node/1', x: 0.1, y: 0.2 }, { ref: 'node/99', x: 0.5, y: 0.5 }], v), (e) => e instanceof ApiError && e.status === 400 && /node\/99/.test(e.message));
	await assert.rejects(setPins(root, FOO, 'b.jpg', [{ ref: 'n1', x: 0.1, y: 0.2 }], v), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(setPins(root, FOO, 'b.jpg', [{ ref: 'node/1', x: 1.2, y: 0.2 }], v), (e) => e instanceof ApiError && e.status === 400);
	assert.equal(postOf(root), PIN_POST);
});

test('setPins writes rounded pins after blur, clears pinsReview, and an empty list removes them', async () => {
	const root = pinRepo();
	const r = await setPins(root, FOO, 'a.jpg', [{ ref: 'node/1', x: 0.123456, y: 1 }, { ref: 'way/2', x: 0, y: 0.5 }], version(root));
	assert.equal(entryLine(root, 'a.jpg'), "  a.jpg: {w: 10, h: 10, blur: 'data:a', pins: [{ref: node/1, x: 0.1235, y: 1}, {ref: way/2, x: 0, y: 0.5}]}");
	assert.equal(r.version, version(root));
	await assert.rejects(setPins(root, FOO, 'a.jpg', [], 'stale'), (e) => e instanceof StaleDocError);
	await setPins(root, FOO, 'a.jpg', [], r.version);
	assert.equal(entryLine(root, 'a.jpg'), "  a.jpg: {w: 10, h: 10, blur: 'data:a'}");
	// only that entry changed
	assert.equal(postOf(root), PIN_POST.replace(", pinsReview: true}", "}"));
});

test('setCaption edits only the matching image line', async () => {
	const root = pinRepo();
	const r = await setCaption(root, FOO, 'a.jpg', 'Wallberg (1722 m) from the [hut](https://h.example)', version(root));
	assert.equal(postOf(root), PIN_POST.replace('![Old caption with [credit](https://x.example)](', '![Wallberg (1722 m) from the [hut](https://h.example)]('));
	assert.equal(r.version, version(root));
	assert.equal(r.caption, 'Wallberg (1722 m) from the [hut](https://h.example)');
	await setCaption(root, FOO, '/images/hikes/topo/t.jpg', 'Topo map', r.version);
	assert.match(postOf(root), /^!\[Topo map\]\(\/images\/hikes\/topo\/t\.jpg\)$/m);
	await assert.rejects(setCaption(root, FOO, 'a.jpg', 'two\nlines', version(root)), (e) => e instanceof ApiError && e.status === 400);
	await assert.rejects(setCaption(root, FOO, 'a.jpg', 'unbalanced ] bracket', version(root)), (e) => e instanceof ApiError && e.status === 400);
});

test('setCaption 409 when the photo isn\'t in the text', async () => {
	const root = pinRepo(PIN_POST.replace('  /images/hikes/topo/t.jpg: {w: 5, h: 5}', '  /images/hikes/topo/t.jpg: {w: 5, h: 5}\n  c.jpg: {w: 1, h: 1}'));
	const before = postOf(root);
	await assert.rejects(setCaption(root, FOO, 'b.jpg', 'x', version(root)), (e) => e instanceof ApiError && e.status === 409 && /not placed in the text/.test(e.message));
	await assert.rejects(setCaption(root, FOO, 'c.jpg', 'x', version(root)), (e) => e instanceof ApiError && e.status === 409 && /more than once/.test(e.message));
	assert.equal(postOf(root), before);
});

test('pinState gives the pins with their store names and the caption state', async () => {
	const root = pinRepo();
	await setPins(root, FOO, 'a.jpg', [{ ref: 'node/1', x: 0.5, y: 0.25 }], version(root));
	const s = pinState(root, FOO, 'a.jpg');
	assert.deepEqual(s.pins, [{ ref: 'node/1', x: 0.5, y: 0.25, name: 'Wallberg', ele: 1722, lat: 47.1, lon: 11.1, missing: false }]);
	assert.equal(s.caption, 'Old caption with [credit](https://x.example)');
	assert.equal(s.captionState, 'ok');
	assert.equal(pinState(root, FOO, 'b.jpg').captionState, 'missing');
	assert.throws(() => pinState(root, FOO, 'zzz.jpg'), (e) => e instanceof ApiError && e.status === 404);
});

test('setCaption refuses a caption ending in a lone backslash', async () => {
	const root = pinRepo();
	await assert.rejects(setCaption(root, FOO, 'a.jpg', 'ends in \\', version(root)), (e) => e instanceof ApiError && e.status === 400);
	assert.equal(postOf(root), PIN_POST);
	await setCaption(root, FOO, 'a.jpg', 'escaped \\\\ ok', version(root));
	assert.match(postOf(root), /^!\[escaped \\\\ ok\]\(/m);
});

// ---------------------------------------------------------------- place docs

const PLACE = `---
title: Foo hut
description: A hut.
---
About the hut.
`;
function placeRepo(raw = PLACE): string {
	const root = repo(POST);
	mkdirSync(join(root, PLACES_MD), { recursive: true });
	writeFileSync(join(root, PLACES_MD, 'foo.md'), raw);
	return root;
}
const placeOf = (root: string) => readFileSync(join(root, PLACES_MD, 'foo.md'), 'utf8');
const placeVersion = (root: string) => loadPlace(root, 'foo').version;

test('place photos go to the place folder', async () => {
	const root = placeRepo();
	const post = postOf(root);
	const immich = stubImmich({ a1: { takenLocal: '2025-07-04T10:00:00+02:00', lat: 47.4, lon: 11.1 }, a2: {} });
	const r = await addFromImmich(root, FOO_PLACE, 'a1', placeVersion(root), { ...deps(immich), today: () => '2026-10-29' });
	assert.equal(r.key, '2025-07-04-00.jpg');
	assert.equal(r.href, '/images/projects/data-viz/hikes/places/foo/2025-07-04-00.jpg');
	assert.deepEqual(readdirSync(join(root, PLACE_IMAGES, 'foo')).sort(), ['2025-07-04-00-1280.avif', '2025-07-04-00-2560.avif', '2025-07-04-00-640.avif']);
	assert.match(placeOf(root), /^images:\n {2}2025-07-04-00\.jpg: \{w: 3000, h: 2000, lat: 47\.4, lon: 11\.1, demEle: 1371\.3, taken: '2025-07-04T10:00:00\+02:00', blur: /m);
	assert.equal(r.version, placeVersion(root));
	assert.deepEqual(readLinks(root)['places/foo.md'], { '2025-07-04-00.jpg': 'a1' });
	// the hike of the same slug is untouched: its post, its stories folder
	assert.equal(postOf(root), post);
	assert.equal(existsSync(join(root, STORIES, 'foo')), false);
	// without a taken time: today's date, numbered per date
	const r2 = await addFromImmich(root, FOO_PLACE, 'a2', r.version, { ...deps(immich), today: () => '2026-10-29' });
	assert.equal(r2.key, '2026-10-29-00.jpg');
	assert.deepEqual(postPhotos(root, FOO_PLACE).map((p) => [p.key, p.assetId, p.href]), [
		['2025-07-04-00.jpg', 'a1', '/images/projects/data-viz/hikes/places/foo/2025-07-04-00.jpg'],
		['2026-10-29-00.jpg', 'a2', '/images/projects/data-viz/hikes/places/foo/2026-10-29-00.jpg']
	]);
	// a stale place base is refused with the place doc (no mirrors)
	await assert.rejects(addFromImmich(root, FOO_PLACE, 'a3', 'old', deps(stubImmich({ a3: {} }))), (e) => e instanceof StaleDocError && e.version === placeVersion(root) && e.fields['place.title'] === 'Foo hut');
	// removing frees the place folder's tiers too
	const del = await removePhoto(root, FOO_PLACE, r2.key, r2.version, { isTracked: () => true });
	assert.equal(del.tiersRemoved, true);
	assert.equal(readdirSync(join(root, PLACE_IMAGES, 'foo')).some((f) => f.startsWith('2026-10-29-00')), false);
	assert.deepEqual(readLinks(root)['places/foo.md'], { '2025-07-04-00.jpg': 'a1' });
});

test('a place doc is never stamped updated', async () => {
	const root = placeRepo();
	const tracked = { isTracked: () => true, today: () => '2026-10-29', terrain: { height: () => 1000 } };
	const add = await addFromImmich(root, FOO_PLACE, 'a1', placeVersion(root), { ...tracked, immich: stubImmich({ a1: {} }) });
	assert.equal(add.stamped, false);
	const up = await addUpload(root, FOO_PLACE, await jpeg(), 'x.jpg', { target: 'stories' }, add.version, tracked);
	assert.equal(up.stamped, false);
	assert.equal(up.key, '2026-10-29-01.jpg');
	const del = await removePhoto(root, FOO_PLACE, add.key, up.version, tracked);
	assert.equal(del.stamped, false);
	assert.doesNotMatch(placeOf(root), /updated/);
});

test('existing post photo tests pass unchanged with post refs', async () => {
	// A post ref keeps the Plan 4 behaviour: stories folder, links under the post file, updated: stamped once published.
	const root = placeRepo();
	const place = placeOf(root);
	const r = await addFromImmich(root, FOO, 'a1', version(root), { ...deps(stubImmich({ a1: {} })), isTracked: () => true, today: () => '2026-10-29' });
	assert.equal(r.key, '2024-01-01-04.jpg');
	assert.equal(r.href, '/images/projects/data-viz/hikes/stories/foo/2024-01-01-04.jpg');
	assert.equal(r.stamped, true);
	assert.deepEqual(readLinks(root)['2024-01-01-foo.md'], { '2024-01-01-04.jpg': 'a1' });
	assert.equal(placeOf(root), place);
	// a hike ref (no post) has no photos
	await assert.rejects(addFromImmich(root, { kind: 'hike', slug: 'foo' }, 'a1', version(root), deps(stubImmich({ a1: {} }))), (e) => e instanceof ApiError && e.status === 400);
});

test('place photos: alt, time, pins work; location from the track is refused', async () => {
	const root = placeRepo();
	const add = await addFromImmich(root, FOO_PLACE, 'a1', placeVersion(root), { ...deps(stubImmich({ a1: { takenLocal: '2025-07-04T10:00:00+02:00' } })) });
	const alt = await setAlt(root, FOO_PLACE, add.key, 'The hut', add.version);
	const t = await setTime(root, FOO_PLACE, [add.key], { shiftMinutes: 5 }, alt.version);
	assert.match(placeOf(root), /taken: '2025-07-04T10:05:00\+02:00'/);
	await assert.rejects(setLocation(root, FOO_PLACE, add.key, { fromTrack: true }, t.version), (e) => e instanceof ApiError && e.status === 422);
	assert.equal(pinState(root, FOO_PLACE, add.key).href, '/images/projects/data-viz/hikes/places/foo/2025-07-04-00.jpg');
});

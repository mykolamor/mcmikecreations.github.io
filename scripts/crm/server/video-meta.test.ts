import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { complete, createStubFetcher, firstParagraph, inLanguage, localizedTexts, trimLetterbox, videoEntry, youtubeId, type VideoFetcher } from './video-meta';

const VID = 'B5yRsnelCsw';
const FIX = join(__dirname, 'fixtures/youtube');
const POSTERS = 'static/images/projects/data-viz/hikes/videos';

const next = (title: string, description: string) =>
	`{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":${JSON.stringify(title)}}]}},"attributedDescription":{"content":${JSON.stringify(description)}}}`;

function fake(over: Partial<VideoFetcher> = {}): VideoFetcher & { calls: string[] } {
	const stub = createStubFetcher();
	const calls: string[] = [];
	return {
		calls,
		page: async (id) => (calls.push('page'), stub.page(id)),
		localized: async (id, lang) => (calls.push('localized'), stub.localized(id, lang)),
		thumbnail: async (id) => (calls.push('thumbnail'), stub.thumbnail(id)),
		...over
	};
}
const tmpRoot = () => mkdtempSync(join(tmpdir(), 'video-meta-'));

test('youtubeId accepts the five URL shapes and rejects others', () => {
	assert.equal(youtubeId(`https://www.youtube.com/watch?v=${VID}&t=10`), VID);
	assert.equal(youtubeId(`https://youtu.be/${VID}`), VID);
	assert.equal(youtubeId(`https://www.youtube.com/shorts/${VID}`), VID);
	assert.equal(youtubeId(`https://www.youtube.com/embed/${VID}`), VID);
	assert.equal(youtubeId(`https://www.youtube.com/live/${VID}`), VID);
	assert.equal(youtubeId('https://www.youtube.com/results?search_query=x'), null);
	assert.equal(youtubeId(`https://example.com/watch?v=${VID}`), null);
	assert.equal(youtubeId('https://www.youtube.com/watch?v=short'), null);
	assert.equal(youtubeId('not a url'), null);
});

test('firstParagraph trims to 500 chars at a word and adds …', () => {
	assert.equal(firstParagraph('one two three four', 10), 'one two…');
	assert.equal(firstParagraph('a\nb\n\nsecond'), 'a b');
	const long = firstParagraph('word '.repeat(200));
	assert.ok(long.length <= 501 && long.endsWith('word…'));
});

test('localized drops a Cyrillic text asked in en and a de text equal to en', async () => {
	const en = next('Stuck in a gorge', 'We test.');
	const uk = next('Застрягли', '6 березня.');
	const texts = await localizedTexts(fake({ localized: async (_id, l) => (l === 'uk' ? uk : en) }), VID);
	assert.deepEqual(texts, { title: { en: 'Stuck in a gorge', uk: 'Застрягли' }, description: { en: 'We test.', uk: '6 березня.' } });
	const cyr = await localizedTexts(fake({ localized: async () => uk }), VID);
	assert.deepEqual(cyr, { title: { uk: 'Застрягли' }, description: { uk: '6 березня.' } });
	assert.equal(inLanguage('abc', 'en'), true);
	assert.equal(inLanguage('абв', 'en'), false);
});

test('trimLetterbox removes the bars of a 4:3 thumbnail', async () => {
	const src = readFileSync(join(FIX, 'hqdefault.jpg'));
	const { data, info } = await trimLetterbox(src);
	assert.equal(info.height, 720);
	assert.equal((await sharp(data).metadata()).height, 720);
	const plain = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#88aa44' } }).jpeg().toBuffer();
	const same = await trimLetterbox(plain);
	assert.equal(same.data, plain);
	assert.equal(same.info.height, 36);
});

test('videoEntry keeps a hand-edited description and writes blur last', async () => {
	const root = tmpRoot();
	const old = { description: { en: 'Mine.' } };
	const e = (await videoEntry(root, VID, old, fake(), { refresh: false }))!;
	assert.deepEqual(Object.keys(e), ['uploadDate', 'duration', 'title', 'description', 'w', 'h', 'blur']);
	assert.deepEqual(e.description, { en: 'Mine.', uk: '6 березня 2025.' });
	assert.deepEqual(e.title, { en: 'Stuck in a gorge', uk: 'Застрягли в ущелині' });
	assert.equal(e.uploadDate, '2025-08-03T07:30:07-07:00');
	assert.equal(e.duration, 'PT36M42S');
	assert.deepEqual([e.w, e.h], [1280, 720]);
	assert.match(String(e.blur), /^data:image\/webp/);
	assert.ok(existsSync(join(root, POSTERS, `${VID}.jpg`)));
	assert.ok(existsSync(join(root, POSTERS, `${VID}-640.avif`)));
	const r = (await videoEntry(root, VID, old, fake(), { refresh: true }))!;
	assert.ok(String((r.description as Record<string, string>).en).startsWith('March 6'));
});

test('a private video yields {unavailable: true}', async () => {
	const root = tmpRoot();
	assert.deepEqual(await videoEntry(root, 'PrivateVid1', null, fake(), { refresh: false }), { unavailable: true });
	assert.equal(existsSync(join(root, POSTERS)), false);
});

test('network failure yields null and writes nothing', async () => {
	const root = tmpRoot();
	const f = fake({ thumbnail: async () => { throw new Error('offline'); } });
	assert.equal(await videoEntry(root, VID, null, f, { refresh: false }), null);
	assert.equal(existsSync(join(root, POSTERS)), false);
});

function warnings<T>(run: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
	const orig = console.warn;
	const warns: string[] = [];
	console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
	return run().then((result) => ({ result, warns })).finally(() => (console.warn = orig));
}

test('an existing poster keeps its tier bytes and mtimes', async () => {
	const root = tmpRoot();
	await videoEntry(root, VID, null, fake(), { refresh: false });
	const files = ['', '-640', '-1280'].map((t) => join(root, POSTERS, `${VID}${t}${t ? '.avif' : '.jpg'}`));
	const old = new Date('2020-01-01T00:00:00Z');
	for (const f of files) utimesSync(f, old, old);
	const before = files.map((f) => [readFileSync(f), statSync(f).mtimeMs] as const);
	const f = fake();
	const e = (await videoEntry(root, VID, null, f, { refresh: false }))!;
	assert.deepEqual([e.w, e.h], [1280, 720]);
	assert.ok(!f.calls.includes('thumbnail'));
	files.forEach((file, i) => {
		assert.ok(readFileSync(file).equals(before[i][0]));
		assert.equal(statSync(file).mtimeMs, before[i][1]);
	});
});

test('missing tiers of an existing poster are encoded and the others left alone', async () => {
	const root = tmpRoot();
	await videoEntry(root, VID, null, fake(), { refresh: false });
	const keep = join(root, POSTERS, `${VID}-640.avif`);
	const gone = join(root, POSTERS, `${VID}-1280.avif`);
	const old = new Date('2020-01-01T00:00:00Z');
	utimesSync(keep, old, old);
	const bytes = readFileSync(keep);
	rmSync(gone);
	await videoEntry(root, VID, null, fake(), { refresh: false });
	assert.ok(existsSync(gone));
	assert.ok(readFileSync(keep).equals(bytes));
	assert.equal(statSync(keep).mtimeMs, old.getTime());
});

test('the tiers of a letterboxed thumbnail come from the trimmed pixels', async () => {
	const root = tmpRoot();
	await videoEntry(root, VID, null, fake(), { refresh: false });
	const m = await sharp(join(root, POSTERS, `${VID}-640.avif`)).metadata();
	assert.deepEqual([m.width, m.height], [640, 360]);
});

test('complete needs the required fields and an English title', () => {
	const ok = { uploadDate: 'd', duration: 'PT1S', title: { en: 'T' }, w: 1, h: 1, blur: 'b' };
	assert.equal(complete(ok), true);
	assert.equal(complete({ ...ok, title: { uk: 'Т' } }), false);
	assert.equal(complete({ ...ok, title: 'plain' }), false);
	assert.equal(complete({ ...ok, blur: undefined }), false);
	assert.equal(complete({ unavailable: true }), false);
	assert.equal(complete(null), false);
});

test('warnings name the video; a network error returns null but a disk error throws', async () => {
	const off = await warnings(() => videoEntry(tmpRoot(), VID, null, fake({ page: async () => { throw new Error('offline'); } }), { refresh: false }));
	assert.equal(off.result, null);
	assert.deepEqual(off.warns, [`could not fetch ${VID}: offline`]);

	const none = await warnings(() => videoEntry(tmpRoot(), VID, null, fake({ thumbnail: async () => null }), { refresh: false }));
	assert.ok(none.warns.includes(`${VID} has no thumbnail`));
	assert.equal(none.result?.w, undefined);

	const uk = next('Застрягли', '6 березня.');
	const noEn = await warnings(() => videoEntry(tmpRoot(), VID, null, fake({ localized: async () => uk }), { refresh: false }));
	assert.ok(noEn.warns.includes(`${VID} has no English title`));

	const file = join(tmpRoot(), 'a-file');
	writeFileSync(file, 'x');
	await assert.rejects(videoEntry(file, VID, null, fake(), { refresh: false }));
});

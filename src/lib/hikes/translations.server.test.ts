// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/translations.server.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assembleHikes, defaultMetaPath, metaFolder } from '$lib/data/hikes-core.js';
import type { HikeMeta } from '$lib/data/map-info';
import { parsePlaceDoc } from './place-docs.server';
import {
	collectTranslations,
	mergeTranslations,
	parseTranslation,
	splitTranslations,
	staticMediaExists
} from './translations.server';

const POST = '---\ntitle: X\n---\nThe walk.\n\n![Hut](/images/x/hut.jpg)\n';
const POST_DE = '---\ntitle: X (de)\ndescription: Über X.\n---\nDie Wanderung.\n\n![Hütte](/images/x/hut.jpg)\n';
const PLACE = '---\ntitle: Knorrhütte\ndescription: DAV hut.\n---\nThe hut.\n';
const PLACE_DE = '---\ntitle: Knorrhütte\ndescription: DAV-Hütte.\naliases: [Knorr]\n---\nDie Hütte.\n';

const META = { name: 'X', description: 'X', image: '', origin: {}, height: 0, checkpoints: [] } as unknown as HikeMeta;
const MEDIA = new Set(['/images/x/hut.jpg']);
const mediaExists = (href: string) => MEDIA.has(href);

/** Every date of the hikes `assembleHikes` builds from a markdown folder's documents. */
function postDates(docs: Record<string, string>) {
	const hikes = assembleHikes({
		slugs: ['x'],
		posts: Object.keys(docs).map((file) => ({ file, path: `${metaFolder}/${file}`, frontmatter: {} })),
		overrides: [],
		getHikeMeta: (p) => (p === defaultMetaPath('x') ? META : undefined),
		hasGpxFile: () => false
	});
	return hikes.flatMap((h) => h.properties.dates);
}

test('a .de.md next to a post is not a post', () => {
	const alone = splitTranslations({ '2026-07-19-x.md': POST });
	const { docs, translations } = splitTranslations({ '2026-07-19-x.md': POST, '2026-07-19-x.de.md': POST_DE });
	assert.deepEqual(Object.keys(docs), ['2026-07-19-x.md']);
	assert.equal(postDates(docs).length, postDates(alone.docs).length);
	assert.equal(postDates(docs).length, 1);

	const all = mergeTranslations({
		posts: collectTranslations('post', translations, new Set(Object.keys(docs)), { mediaExists }),
		places: new Map()
	});
	const de = all.get('2026-07-19-x.md')?.de;
	assert.equal(de?.title, 'X (de)');
	assert.equal(de?.description, 'Über X.');
	assert.match(de?.body ?? '', /Die Wanderung/);
});

test('a place translation is not a place doc', () => {
	const { docs, translations } = splitTranslations({ 'knorrhuette.md': PLACE, 'knorrhuette.de.md': PLACE_DE });
	assert.deepEqual(Object.keys(docs), ['knorrhuette.md']);
	// What places.server.ts does with each document: the translation would fail its slug rule.
	assert.deepEqual(Object.entries(docs).map(([file, raw]) => parsePlaceDoc(file, raw).slug), ['knorrhuette']);
	assert.throws(() => parsePlaceDoc('knorrhuette.de.md', PLACE_DE), /name it <slug>\.md/);

	const all = mergeTranslations({
		posts: new Map(),
		places: collectTranslations('place', translations, new Set(Object.keys(docs)), { mediaExists })
	});
	assert.deepEqual(all.get('places/knorrhuette.md')?.de?.aliases, ['Knorr']);
	assert.equal(all.get('knorrhuette.md'), undefined);
});

test('an unknown language file fails the build naming it', () => {
	for (const file of ['2026-07-19-x.fr.md', '2026-07-19-x.DE.md', 'knorrhuette.fr.md']) {
		assert.throws(
			() => splitTranslations({ '2026-07-19-x.md': POST, [file]: POST_DE }),
			(e: Error) => e.message.includes(`in ${file}`),
			file
		);
	}
});

test('a translation without its source fails naming both', () => {
	const { translations } = splitTranslations({ '2026-07-19-y.de.md': POST_DE });
	assert.throws(
		() => collectTranslations('post', translations, new Set(['2026-07-19-x.md']), { mediaExists }),
		/2026-07-19-y\.de\.md.*2026-07-19-y\.md/
	);
});

test('a translation with a disallowed front-matter key fails', () => {
	const file = '2026-07-19-x.de.md';
	assert.throws(
		() => parseTranslation(file, '---\ntitle: X\nimages: {}\n---\n', 'post'),
		/2026-07-19-x\.de\.md: unknown front matter key "images" \(expected title, description\)/
	);
	// A place translation may carry aliases; a post translation may not.
	assert.throws(() => parseTranslation(file, '---\naliases: [X]\n---\n', 'post'), /unknown front matter key "aliases"/);
	assert.deepEqual(parseTranslation('k.de.md', '---\naliases: [K]\n---\n', 'place').aliases, ['K']);
	// The other ways a translation's front matter fails.
	assert.throws(() => parseTranslation(file, '---\ntitle: ""\n---\n', 'post'), /2026-07-19-x\.de\.md: title is empty/);
	assert.throws(() => parseTranslation(file, '---\ntitle: [\n---\n', 'post'), /2026-07-19-x\.de\.md: malformed front matter/);
});

test('an empty-body translation is valid', () => {
	assert.deepEqual(parseTranslation('2026-07-19-x.de.md', '---\ntitle: X (de)\n---\n', 'post'), {
		lang: 'de',
		source: '2026-07-19-x.md',
		title: 'X (de)',
		body: ''
	});
	assert.deepEqual(parseTranslation('knorrhuette.de.md', '', 'place'), {
		lang: 'de',
		source: 'knorrhuette.md',
		body: ''
	});
});

test("a translation's local media must exist", () => {
	const sources = new Set(['2026-07-19-x.md']);
	const check = (body: string) => collectTranslations('post', { '2026-07-19-x.de.md': `${POST_DE}\n${body}\n` }, sources, { mediaExists });
	assert.throws(() => check('![Clip](/images/x/clip.mp4 "autoplay")'), /2026-07-19-x\.de\.md: \/images\/x\/clip\.mp4 does not exist/);
	// Remote media and the 404 placeholder aren't files of this site.
	assert.equal(check('![a](https://x/y.jpg)\n![b](/404/)').size, 1);
});

test('the media check reads images as the renderer does', () => {
	const sources = new Set(['2026-07-19-x.md']);
	const check = (body: string) => collectTranslations('post', { '2026-07-19-x.de.md': `${POST_DE}\n${body}\n` }, sources, { mediaExists });
	// An alt text holding a link, as the posts' video credits do.
	const credited = (href: string) => `![Zusammenschnitt von [David Bilan](https://bilandavid.com/)](${href} "autoplay")`;
	assert.throws(() => check(credited('/images/x/clip.mp4')), /\/images\/x\/clip\.mp4 does not exist/);
	assert.equal(check(credited('/images/x/hut.jpg')).size, 1);
	// Single-quoted titles, <…> hrefs, inline and nested images.
	assert.throws(() => check("![a](/images/x/gone.jpg 'Titel')"), /\/images\/x\/gone\.jpg does not exist/);
	assert.throws(() => check('![a](</images/x/gone.jpg> "Titel")'), /\/images\/x\/gone\.jpg does not exist/);
	assert.throws(() => check('Text ![a](/images/x/gone.jpg) mehr.'), /gone\.jpg does not exist/);
	assert.throws(() => check('- ![a](/images/x/gone.jpg)'), /gone\.jpg does not exist/);
	// A malformed escape fails naming the translation.
	assert.throws(() => check('![a](/images/x/%E0%A4%A.jpg)'), /2026-07-19-x\.de\.md: \/images\/x\/%E0%A4%A\.jpg: malformed URL escape/);
});

test('post and place translations of the same name are kept apart', () => {
	const t = (title: string) => new Map([['2026-07-19-x.md', { de: { lang: 'de' as const, source: '2026-07-19-x.md', title, body: '' } }]]);
	const all = mergeTranslations({ posts: t('Post'), places: t('Place') });
	assert.equal(all.get('2026-07-19-x.md')?.de?.title, 'Post');
	assert.equal(all.get('places/2026-07-19-x.md')?.de?.title, 'Place');
});

test('a photo counts as there when only its AVIF tiers are', () => {
	// The posts' originals mostly aren't kept in static/, only the tiers the page serves.
	const root = fileURLToPath(new URL('../../..', import.meta.url));
	const photo = '/images/projects/data-viz/hikes/stories/grosser_laber/2026-09-06-00.jpg';
	assert.equal(staticMediaExists(photo, root), true);
	assert.equal(staticMediaExists('/images/projects/data-viz/hikes/stories/grosser_laber/no-such-photo.jpg', root), false);
	assert.equal(staticMediaExists('/images/projects/data-viz/hikes/stories/grosser_laber/no-such-clip.mp4', root), false);
	// Against the root it is given, not the working directory.
	assert.equal(staticMediaExists(photo, tmpdir()), false);
});

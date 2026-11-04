// Run with: node_modules/.bin/jiti src/lib/hikes/list-strings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { paragraphTexts, t } from '../i18n/strings';
import { paragraphs } from '../i18n/paragraphs';
import {
	hikePostTitle,
	hikesListDescription,
	hikesListTitle,
	hikesTagDescription,
	hikesTagTitle,
	hikesYearDescription,
	hikesYearTitle,
	tagLabel,
	tagStrings
} from './hikes-meta';
import EN from './i18n/en.json';

/**
 * The `/hikes/` list pages and the components they render that show text
 * (Footsteps, ShowcaseGrid, ShowcaseTile and the two JSON feeds show none of their own).
 * Not yet: HikesSearchBar (in every page's navbar), the search page and the
 * `/hikes/` layout. No module holding the tables sits on their pages' scripts,
 * so reading them there adds a preloaded chunk to the prerendered HTML.
 */
const LIST_FILES = [
	'src/lib/hikes/hikes-meta.ts',
	'src/routes/hikes/+page.svelte',
	'src/routes/hikes/page/[page]/+page.svelte',
	'src/routes/hikes/year/[year]/+page.svelte',
	'src/routes/hikes/year/[year]/page/[page]/+page.svelte',
	'src/routes/hikes/tag/[tag]/+page.svelte',
	'src/routes/hikes/tag/[tag]/+page.server.ts',
	'src/routes/hikes/tag/[tag]/page/[page]/+page.svelte',
	'src/routes/hikes/feed.xml/+server.ts',
	'src/routes/hikes/atom.xml/+server.ts',
	'src/routes/hikes/components/HikeList.svelte',
	'src/routes/hikes/components/HikeTagPage.svelte',
	'src/routes/hikes/components/YearsNav.svelte',
	'src/routes/hikes/components/CustomPagination.svelte',
	'src/routes/hikes/components/HikesTimeline.svelte',
	'src/routes/hikes/components/HikesWeb.svelte',
	'src/routes/hikes/components/Feeds.svelte',
	'src/routes/hikes/components/Hero.svelte'
];
/** The string groups those files read. */
const LIST_GROUPS = ['meta', 'nav', 'home', 'showcase', 'list', 'tags', 'web', 'feeds'] as const;
const CALL = /\b(t|tSplit|tHtml|paragraphs|paragraphTexts)\(\s*'en'\s*,\s*'([^']+)'/g;

test('every t() key used under src/routes/hikes and src/lib/hikes exists in en.json', () => {
	const files = [...sourceFiles('src/routes/hikes'), ...sourceFiles('src/lib/hikes')];
	for (const file of files) {
		for (const [, fn, key] of read(file).matchAll(CALL)) {
			const value = lookup(key);
			assert.notEqual(value, undefined, `${file}: ${key}`);
			const list = fn === 'paragraphs' || fn === 'paragraphTexts';
			assert.equal(Array.isArray(value), list, `${file}: ${key} is ${list ? 'not ' : ''}a paragraph list`);
		}
	}
	for (const file of LIST_FILES) assert.match(read(file), new RegExp(CALL.source), `${file} reads no string from the tables`);
});

test('the list pages hold none of the tables\' English', () => {
	// Every literal run of a table string (between placeholders) of two words or more.
	const runs = LIST_GROUPS.flatMap((group) => leaves((EN as Record<string, unknown>)[group]))
		.flatMap((s) => s.split(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/))
		.map((run) => run.trim())
		.filter((run) => /\S\s+\S/.test(run) && run.length >= 8);
	assert.ok(runs.length > 40, `only ${runs.length} runs`);
	for (const file of LIST_FILES) {
		const source = read(file).replace(/\s+/g, ' ');
		for (const run of runs) assert.ok(!source.includes(run.replace(/\s+/g, ' ')), `${file} still holds "${run}"`);
	}
});

test('every tag with its own strings has them all, and posts use it', () => {
	const KEYS = ['label', 'title', 'description', 'breadcrumb', 'heading', 'intro'];
	const own = Object.keys(EN.tags);
	for (const tag of own) {
		for (const key of KEYS) assert.notEqual(lookup(`tags.${tag}.${key}`), undefined, `tags.${tag}.${key}`);
		assert.deepEqual(tagStrings('en', tag)?.breadcrumb, t('en', `tags.${tag}.breadcrumb`));
	}
	const used = postTags();
	assert.ok(used.size > 5, `only ${used.size} tags`);
	for (const tag of own) assert.ok(used.has(tag), `no post is tagged ${tag}`);
	// The tag page's own sections are for tags with strings.
	const special = [...read('src/routes/hikes/tag/[tag]/+page.svelte').matchAll(/tag === '([^']+)'/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(special)].sort(), [...own].sort());
	// Any other tag reads as itself.
	for (const tag of used) if (!own.includes(tag)) {
		assert.equal(tagLabel('en', tag), tag);
		assert.equal(tagStrings('en', tag), undefined);
	}
	assert.equal(tagStrings('en', 'constructor'), undefined);
	assert.equal(tagLabel('en', 'toString'), 'toString');
});

test('the meta texts read as before', () => {
	const SITE = ' | Personal Hike Experiences';
	assert.equal(t('en', 'meta.blogTitle'), 'Hiking, Climbing, Via Ferrata & Trail Maps' + SITE);
	assert.equal(hikePostTitle('Aiplspitz'), 'Aiplspitz | Hike');
	assert.equal(hikesListTitle(3), 'Hiking Blog - Page 3' + SITE);
	assert.equal(hikesListDescription(3), 'Browse hiking blog posts - Page 3');
	assert.equal(hikesTagTitle('DAAD FK', 1), 'Hikes tagged "DAAD FK"' + SITE);
	assert.equal(hikesTagTitle('DAAD FK', 2), 'Hikes tagged "DAAD FK" - Page 2' + SITE);
	assert.equal(hikesTagDescription('Nepal', 1), 'Browse hiking blog posts tagged with Nepal');
	assert.equal(hikesTagDescription('Nepal', 4), 'Browse hiking blog posts tagged with Nepal - Page 4');
	assert.equal(hikesYearTitle(2024, 1), 'Hikes from 2024' + SITE);
	assert.equal(hikesYearTitle(2024, 2), 'Hikes from 2024 - Page 2' + SITE);
	assert.equal(hikesYearDescription(2024, 1), 'Browse hiking blog posts from 2024');
	assert.equal(hikesYearDescription(2024, 12), 'Browse hiking blog posts from 2024 - Page 12');
	// Climb's own description is the generic one it fell back to.
	assert.equal(tagStrings('en', 'Climb')?.description, hikesTagDescription('Climb', 1));
});

// Strings shown only after hydration (the Web map, its peak list and popovers):
// the build-hash gate never sees them, so each is pinned to the template text it replaced.
test('the client-only strings read as before', () => {
	assert.equal(t('en', 'web.week', { label: '2024-01-01 to 2024-01-07' }), 'Week: 2024-01-01 to 2024-01-07');
	assert.equal(t('en', 'web.peaks', { count: 1 }), '1 bagged peaks');
	assert.equal(t('en', 'web.peaks', { count: 17 }), '17 bagged peaks');
	assert.equal(t('en', 'web.unnamedPeak'), 'Unnamed peak');
	assert.equal(t('en', 'web.elevation', { value: '2,962' }), '2,962 m');
	assert.equal(t('en', 'web.toggleColors'), 'Toggle colors');
	assert.equal(t('en', 'web.ranges'), 'Mountain ranges');
	assert.equal(t('en', 'web.areas'), 'Hike areas');
	for (const [key, label] of [['distance', 'Distance'], ['duration', 'Duration'], ['ascent', 'Ascent'], ['descent', 'Descent'], ['posts', 'Posts']]) {
		assert.equal(t('en', `web.popup.${key}`, { value: '12.3 km', links: '<a>x</a>' }), `${label}: ${key === 'posts' ? '<a>x</a>' : '12.3 km'}`);
	}
	assert.equal(t('en', 'web.popup.mapLink'), 'Map Link');
	assert.equal(t('en', 'web.popup.geojson'), 'GeoJSON');
	for (const i of [0, 1, 2]) assert.equal(t('en', 'web.popup.gpx', { n: i + 1 }), `GPX${i > 0 ? ` ${i + 1}` : ''}`);
});

test('paragraphs a page shows as text hold no markdown', () => {
	// Shown with `{text}`, not `{@html}`: right only while marked would render them as the same text.
	const keys = LIST_FILES.flatMap((file) => [...read(file).matchAll(CALL)].filter(([, fn]) => fn === 'paragraphTexts').map(([, , key]) => key));
	assert.deepEqual([...new Set(keys)].sort(), ['showcase.climb.text', 'showcase.web.text', 'tags.Web.intro']);
	for (const key of keys) assert.deepEqual(paragraphs('en', key), paragraphTexts('en', key), key);
	// The pages show them by index, one `<p>` each.
	assert.equal(EN.showcase.web.text.length, 4);
	assert.equal(EN.showcase.climb.text.length, 2);
	assert.equal(EN.tags.Web.intro.length, 1);
});

function read(file: string): string {
	return fs.readFileSync(path.resolve(file), 'utf8');
}

function lookup(key: string): unknown {
	return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], EN);
}

function leaves(node: unknown): string[] {
	if (typeof node === 'string') return [node];
	if (Array.isArray(node)) return node;
	return Object.values(node as Record<string, unknown>).flatMap(leaves);
}

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(path.resolve(dir), { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(full);
		else if (/\.(ts|js|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) yield full;
	}
}

/** Every tag a post's front matter names (translations, `<date>-<slug>.<lang>.md`, carry none). */
function postTags(): Set<string> {
	const dir = path.resolve('static/_projects/data-viz/hikes/markdown');
	const tags = new Set<string>();
	for (const name of fs.readdirSync(dir)) {
		if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9_]+\.md$/.test(name)) continue;
		const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
		for (const tag of (front && parseYaml(front[1])?.tags) ?? []) tags.add(tag);
	}
	return tags;
}

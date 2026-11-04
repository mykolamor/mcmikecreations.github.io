// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/post-strings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, tSplit } from '../i18n/strings';
import { formatTags, nodePopupHtml, nodeTitle } from './map-utils';
import { placeDocMarkerHtml } from './place-docs';
import { photoStopText } from './photo-stops';
import { formatKm } from './facts-format';
import { parseMarkdown } from './hikes-info';
import EN from './i18n/en.json';

/**
 * The post page `/hikes/<post>/` and what it renders that holds text of its own.
 * Not here: `Map3d.svelte` and `Attribution.svelte`, which only the old
 * `/projects/data-viz/hikes/<slug>/` page renders. No module holding the tables
 * sits on that page's scripts, and reading them in Attribution splits the
 * tables' chunk off, one more preloaded chunk on every hike page.
 */
const POST_FILES = [
	'src/routes/hikes/[slug]/+page.svelte',
	'src/routes/hikes/components/HikeContacts.svelte',
	'src/routes/hikes/components/HikePlaces.svelte',
	'src/routes/hikes/components/HikeJsonLd.svelte',
	'src/routes/hikes/components/FactsPlace.svelte',
	'src/lib/components/MediaGallery.svelte',
	'src/lib/hikes/hikes-info.ts',
	'src/lib/hikes/place-docs.ts',
	'src/lib/hikes/photo-stops.ts',
	'src/lib/hikes/photo-pins-view.ts',
	'src/lib/hikes/map-utils.ts',
	'src/lib/hikes/map-2d.ts',
	'src/lib/hikes/map-3d-markers.ts',
	'src/lib/hikes/map-elevation.ts'
];
/**
 * Post page files with no fixed text but the facts labels (read through
 * `facts-format.ts`), or none at all: they're only checked for leftovers.
 */
const QUIET_FILES = [
	'src/routes/hikes/[slug]/+page.server.ts',
	'src/routes/hikes/[slug]/+page.ts',
	'src/routes/hikes/components/HikeFactsTiles.svelte',
	'src/routes/hikes/components/HikeFactsGuide.svelte',
	'src/routes/hikes/components/HikeFactsSafety.svelte',
	'src/routes/hikes/components/FactsSpan.svelte',
	'src/routes/hikes/components/StatTile.svelte',
	'src/lib/hikes/facts-format.ts',
	'src/lib/hikes/facts-overlay.ts',
	'src/lib/hikes/map-3d.ts'
];
/** The string groups those files read. */
const POST_GROUPS = ['post', 'render', 'map', 'gallery', 'jsonLd', 'units', 'nav'] as const;
const CALL = /\b(t|tSplit|tHtml)\(\s*(?:'en'|lang)\s*,\s*'([^']+)'/g;

test('every t() key the post page uses exists in en.json, and its files read them', () => {
	for (const file of [...POST_FILES, ...QUIET_FILES]) {
		for (const [, , key] of read(file).matchAll(CALL)) assert.equal(typeof lookup(key), 'string', `${file}: ${key}`);
	}
	for (const file of POST_FILES) assert.match(read(file), new RegExp(CALL.source), `${file} reads no string from the tables`);
});

test('the post page holds none of the tables\' English', () => {
	// Every literal run of a table string (between placeholders) of two words or more.
	const groups = [...POST_GROUPS.map((group) => (EN as Record<string, unknown>)[group]), EN.facts.labels];
	const runs = groups
		.flatMap(leaves)
		.flatMap((s) => s.split(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/))
		.map((run) => run.trim())
		.filter((run) => /\S\s+\S/.test(run) && run.length >= 8);
	assert.ok(runs.length > 60, `only ${runs.length} runs`);
	for (const file of [...POST_FILES, ...QUIET_FILES]) {
		const source = code(file).replace(/\s+/g, ' ');
		for (const run of runs) assert.ok(!source.includes(run.replace(/\s+/g, ' ')), `${file} still holds "${run}"`);
	}
});

// The page's own text, each pinned to the template text it replaced. The
// build-hash gate checks the prerendered ones too; it never sees the rest.
test('the post page\'s strings read as before', () => {
	const old: Record<string, string> = {
		'post.pagePath': 'Page path',
		'post.expandImage': 'Expand image',
		'post.stats.movingTime': 'Moving time',
		'post.stats.plannerEstimate': 'Planner estimate',
		'post.stats.distance': 'Distance',
		'post.stats.ascent': 'Ascent',
		'post.stats.descent': 'Descent',
		'post.stats.elapsed': 'Elapsed',
		'post.stats.typical': 'Typical time',
		'post.stats.highPoint': 'Highest point',
		'post.stats.lowPoint': 'Lowest point',
		'post.stats.routeType': 'Route type',
		'post.notes.duration.gpx': 'Moving time from my recorded track, breaks excluded.',
		'post.notes.duration.manual': 'My moving time, breaks excluded.',
		'post.notes.duration.planner': "The route planner's (openrouteservice) walking estimate.",
		'post.notes.elapsed.gpx': 'Elapsed is the full time from start to finish of the recorded track, breaks included.',
		'post.notes.elapsed.photos': 'Elapsed is the time between my first and last photo on the route, so the real time was longer.',
		'post.notes.elapsed.manual': 'Elapsed is the full time from start to finish, breaks included.',
		'post.notes.typical': 'Standard DAV walking time without breaks: 300 m up or 500 m down per hour, 4 km per hour on the flat.',
		'post.files.or': 'or',
		'post.files.gpx': 'GPX',
		'post.files.geojson': 'GeoJSON',
		'post.contacts.heading': 'Along for the hike',
		'post.contacts.link': 'link',
		'post.places.heading': 'Places on this route',
		'render.showOnMap': 'Show on the map',
		'render.stop.trackTime': 'Time from my recorded track, where it passed this spot',
		'render.stop.photoTime': 'Time the photo was taken',
		// Shown only in the browser:
		'map.photos': 'Photos',
		'map.facts': 'Route facts',
		'map.osmMirror': 'OSM Mirror',
		'map.photo': 'Photo',
		'map.closePopup': 'Close popup',
		'map.showOnMap': 'Show on map',
		'map.poi': 'POI',
		'map.tags.phone': 'Phone',
		'map.tags.website': 'Website',
		'map.tags.email': 'Email',
		'map.tags.link': 'Link',
		'gallery.label': 'Media gallery',
		'gallery.close': 'Close gallery',
		'gallery.thumbnails': 'Gallery thumbnails',
		'gallery.previous': 'Previous item',
		'gallery.next': 'Next item',
		'gallery.video': 'video'
	};
	for (const [key, text] of Object.entries(old)) assert.equal(t('en', key), text, key);
	assert.deepEqual(tSplit('en', 'post.files.grab', 'files'), ['Grab the ', ' file and embark on your own adventure!']);
	assert.equal(t('en', 'render.stop.showOnMap', { stop: 'km 1.0 · 1200 m' }), 'km 1.0 · 1200 m, show on the map');
	assert.equal(t('en', 'render.placeDocAbout', { title: 'Knorrhütte' }), 'About Knorrhütte');
	assert.equal(t('en', 'gallery.watch', { name: 'Ridge' }), 'Watch Ridge on YouTube (opens in a new tab)');
	assert.equal(t('en', 'units.km', { value: '1.25' }), '1.25 km');
	assert.equal(t('en', 'units.m', { value: 2052 }), '2052 m');
	// The JSON-LD property names (prerendered, but inside a script).
	const jsonLd: Record<string, string> = {
		difficulty: 'Difficulty (SAC)', ferrataGrade: 'Via ferrata grade', exposure: 'Exposure', routeType: 'Route type',
		highPoint: 'Highest point', season: 'Season', carFree: 'Car-free access',
		distance: 'Distance', ascent: 'Ascent', descent: 'Descent', duration: 'Duration'
	};
	for (const [key, text] of Object.entries(jsonLd)) assert.equal(t('en', `jsonLd.${key}`), text, key);
	assert.equal(t('en', 'jsonLd.ferrataScale', { scale: 'schall' }), 'schall scale');
	assert.equal(t('en', 'jsonLd.climbingGrade', { scale: 'UIAA' }), 'Climbing grade (UIAA)');
});

test('the map popups and the renderer\'s lines read as before', async () => {
	const tags = { name: 'Knorrhütte', ele: '2052', phone: '+49 1; +49 2', website: 'hut.example', email: 'a@b.c', wikipedia: 'de:Knorrhütte', opening_hours: 'May-Oct' };
	const link = 'style="color: #2563eb; text-decoration: none;"';
	assert.deepEqual(formatTags(tags), [
		['Phone', `<a href="tel:+49 1" ${link}>+49 1</a>, <a href="tel:+49 2" ${link}>+49 2</a>`],
		['Website', `<a href="https://hut.example" target="_blank" rel="noopener noreferrer" ${link}>Link</a>`],
		['Email', `<a href="mailto:a@b.c" ${link}>a@b.c</a>`],
		['Wikipedia', `<a href="https://de.wikipedia.org/wiki/Knorrh%C3%BCtte" target="_blank" rel="noopener noreferrer" ${link}>de:Knorrhütte</a>`],
		['Opening Hours', 'May-Oct']
	]);
	assert.match(nodePopupHtml(tags), /^<div style="margin-bottom:8px;"><b>Knorrhütte<\/b> \(2052m\)<\/div><div style="max-height:150px;overflow-y:auto;"><table/);
	assert.equal(nodeTitle({}), 'POI');
	assert.equal(photoStopText({ km: 13.44, ele: 2051.6, time: '03:00' }), 'km 13.4 · 2052 m · 03:00');
	assert.equal(formatKm(7.46), 'km 7.5');
	assert.equal(
		placeDocMarkerHtml({ slug: 'knorrhuette', title: 'Knorr & "Co"', names: [] }),
		'<a class="mk-place-doc" href="#place-knorrhuette" data-place-doc="knorrhuette" title="About Knorr &amp; &quot;Co&quot;" aria-label="About Knorr &amp; &quot;Co&quot;" translate="no">ⓘ</a>'
	);

	// The client re-render of the post body passes no `lang`: English, as on the server.
	const md = 'Up to Knorrhütte (2052 m).\n\n![The hut](/x/a.jpg)\n\n![The ridge](/x/b.jpg)\n';
	const stops = new Map([
		[0, { km: 1.04, ele: 1200, time: '11:18', timeSource: 'photo' as const, lat: 47.4, lon: 11 }],
		[1, { km: 2, time: '12:00', timeSource: 'track' as const }]
	]);
	const options = { nodes: [{ lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte', ele: '2052' } }], stops };
	const { html } = await parseMarkdown(md, [], options);
	assert.equal((await parseMarkdown(md, [], { ...options, lang: 'en' })).html, html);
	assert.match(html, /<a class="mk-place" href="#hike-map" data-place-lat="47.41" data-place-lon="10.99" title="Show on the map">Knorrhütte \(2052&nbsp;m\)<\/a>/);
	assert.match(html, /<button type="button" class="mk-photo-stop mk-photo-stop-link" translate="no" data-photo-stop="0" title="Time the photo was taken" aria-label="km 1.0 · 1200 m · 11:18, show on the map">km 1.0 · 1200 m · 11:18<\/button>/);
	assert.match(html, /<span class="mk-photo-stop" translate="no" title="Time from my recorded track, where it passed this spot">km 2.0 · 12:00<\/span>/);
});

function read(file: string): string {
	return fs.readFileSync(path.resolve(file), 'utf8');
}

/** A file's code without its comments, which may quote the strings they describe. */
function code(file: string): string {
	return read(file)
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|\s)\/\/.*$/gm, '$1');
}

function lookup(key: string): unknown {
	return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], EN);
}

function leaves(node: unknown): string[] {
	if (typeof node === 'string') return [node];
	if (Array.isArray(node)) return node;
	return Object.values(node as Record<string, unknown>).flatMap(leaves);
}

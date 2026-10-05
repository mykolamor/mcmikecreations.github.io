// Run with: JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti src/lib/hikes/place-docs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaceDoc, readPostPlaces, type PlaceDoc } from './place-docs.server';
import { buildPlaceDocIndex, placeDocAnchor, type PlaceDocRef } from './place-docs';
import { parseMarkdown } from './hikes-info';

const KNORR = `---
title: Knorrhütte
description: DAV hut below the Zugspitzplatt.
tags: [Hut]
aliases: [Knorr hut]
images:
  2026-07-19-00.jpg: {w: 4000, h: 3000, blur: 'data:image/webp;base64,AA'}
---
The hut.

![Terrace](/images/projects/data-viz/hikes/places/knorrhuette/2026-07-19-00.jpg)
`;

test('a place doc parses into its fields, the title counting as a name', () => {
	const doc = parsePlaceDoc('knorrhuette.md', KNORR);
	assert.equal(doc.slug, 'knorrhuette');
	assert.equal(doc.title, 'Knorrhütte');
	assert.equal(doc.description, 'DAV hut below the Zugspitzplatt.');
	assert.deepEqual(doc.tags, ['Hut']);
	assert.deepEqual(doc.names, ['Knorrhütte', 'Knorr hut']);
	assert.equal(doc.raw, KNORR);
});

test('malformed place docs fail, naming the file', () => {
	const doc = (fm: string) => `---\n${fm}\n---\nText\n`;
	assert.throws(() => parsePlaceDoc('Knorr Hütte.md', doc('title: K\ndescription: D')), /Knorr Hütte\.md: name it <slug>\.md/);
	assert.throws(() => parsePlaceDoc('k.md', doc('description: D')), /k\.md: needs a title/);
	assert.throws(() => parsePlaceDoc('k.md', doc('title: K')), /needs a description/);
	assert.throws(() => parsePlaceDoc('k.md', doc('title: K\ndescription: D\ndate: 2026-01-01')), /unknown front matter key "date"/);
	assert.throws(() => parsePlaceDoc('k.md', doc('title: K\ndescription: D\ntags: Hut')), /tags: expected a list/);
	assert.throws(() => parsePlaceDoc('k.md', doc('title: K\ndescription: D\nimages: [a.jpg]')), /images: expected a map/);
});

test('a post lists place docs by slug; unknown ones fail, naming the post', () => {
	const docs = new Map<string, PlaceDoc>([['knorrhuette', parsePlaceDoc('knorrhuette.md', KNORR)]]);
	assert.deepEqual(readPostPlaces({}, 'p.md', docs), []);
	assert.deepEqual(readPostPlaces({ places: ['knorrhuette', 'knorrhuette'] }, 'p.md', docs).map((d) => d.slug), ['knorrhuette']);
	assert.throws(() => readPostPlaces({ places: ['sonnalpin'] }, '/x/p.md', docs), /Hike post \/x\/p\.md: places: unknown place "sonnalpin"/);
	assert.throws(() => readPostPlaces({ places: 'knorrhuette' }, 'p.md', docs), /expected a list of place slugs/);
});

test('the sidecar lists route places; a post’s own list replaces them', () => {
	const docs = new Map<string, PlaceDoc>([
		['knorrhuette', parsePlaceDoc('knorrhuette.md', KNORR)],
		['sonnalpin', parsePlaceDoc('sonnalpin.md', KNORR)]
	]);
	const sidecar = { places: ['knorrhuette'], source: 's.hike.json' };
	const slugs = (fm: Record<string, unknown>) => readPostPlaces(fm, 'p.md', docs, sidecar).map((d) => d.slug);
	assert.deepEqual(slugs({}), ['knorrhuette']);
	assert.deepEqual(slugs({ places: null }), ['knorrhuette']);
	assert.deepEqual(slugs({ places: ['sonnalpin'] }), ['sonnalpin']);
	assert.deepEqual(slugs({ places: [] }), []);
	assert.throws(
		() => readPostPlaces({}, 'p.md', docs, { places: ['zugspitze'], source: '/x/s.hike.json' }),
		/Hike sidecar \/x\/s\.hike\.json: places: unknown place "zugspitze"/
	);
});

const REFS: PlaceDocRef[] = [{ slug: 'knorrhuette', title: 'Knorrhütte', names: ['Knorrhütte', 'Knorr hut'] }];
const NODES = [{ lat: 47.41, lon: 10.99, tags: { name: 'Knorrhütte', ele: '2052' } }];
const body = (md: string) => '---\ntitle: T\n---\n' + md;
const markers = (html: string) => [...html.matchAll(/<a class="mk-place-doc" href="#([^"]+)"/g)].map((m) => m[1]);

test('the doc index matches names like place links do', () => {
	const index = buildPlaceDocIndex(REFS)!;
	assert.equal(index.match(['Approaching', 'Knorrhütte'])?.start, 1);
	assert.equal(index.match(['Knorr', 'Hütte'])?.doc.slug, 'knorrhuette');
	assert.equal(index.match(['KNORRHUTTE'])?.doc.slug, 'knorrhuette');
	assert.equal(index.match(['Sonnalpin']), null);
	assert.equal(buildPlaceDocIndex([]), null);
	assert.equal(placeDocAnchor('knorrhuette'), 'place-knorrhuette');
});

test('the first reference to a doc gets its marker, after the map link', async () => {
	const md = 'Up to Knorrhütte (2052 m), back past Knorrhütte (2052 m).\n';
	const { html } = await parseMarkdown(body(md), [], { nodes: NODES, placeDocs: REFS });
	assert.deepEqual(markers(html), ['place-knorrhuette']);
	// The map link stays on the name, the marker follows it.
	assert.match(html, /<a class="mk-place" href="#hike-map"[^>]*>Knorrhütte \(2052&nbsp;m\)<\/a><\/span><a class="mk-place-doc" href="#place-knorrhuette" data-place-doc="knorrhuette" title="About Knorrhütte"/);
	// Without nodes, the protected name still gets it.
	const plain = await parseMarkdown(body(md), [], { placeDocs: REFS });
	assert.match(plain.html, /<span translate="no">Knorrhütte \(2052&nbsp;m\)<\/span><a class="mk-place-doc"/);
});

test('no doc markers in headings, links or captions', async () => {
	const md = '## Knorrhütte (2052 m)\n\n[Knorrhütte (2052 m)](/hikes/x/)\n\n![Knorrhütte (2052 m)](/images/a.jpg)\n';
	const { html } = await parseMarkdown(body(md), [], { placeDocs: REFS });
	assert.deepEqual(markers(html), []);
});

test('plain mentions of a doc\'s names are marked like references', async () => {
	const md = 'Lunch at Knorrhütte, then the Knorr-hut terrace. Up to Knorrhütte (2052 m). Not knorrhütte or Knorrhüttenweg.\n\n## Knorrhütte\n\n[Knorrhütte](/hikes/x/)\n';
	const { html } = await parseMarkdown(body(md), [], { nodes: NODES, placeDocs: REFS });
	// Each mention links to the map; only the first reference to the doc, with or without an elevation, gets the marker.
	const mapLinks = [...html.matchAll(/<a class="mk-place" href="#hike-map"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
	assert.deepEqual(mapLinks, ['Knorrhütte', 'Knorrhütte (2052&nbsp;m)']);
	assert.match(html, /at <span translate="no"><a class="mk-place"[^>]*>Knorrhütte<\/a><\/span><a class="mk-place-doc" href="#place-knorrhuette"/);
	assert.deepEqual(markers(html), ['place-knorrhuette']);
	// An alias that names no node is protected from translation, unlinked.
	assert.match(html, /the <span translate="no">Knorr-hut<\/span> terrace/);
	// Without nodes, the name is still protected and the first one carries the marker.
	const plain = await parseMarkdown(body(md), [], { placeDocs: REFS });
	assert.match(plain.html, /at <span translate="no">Knorrhütte<\/span><a class="mk-place-doc"/);
});

test('place: links point at a listed doc; unlisted slugs stay text', async () => {
	const md = 'See [the hut](place:knorrhuette) and [the restaurant](place:sonnalpin).\n';
	const { html } = await parseMarkdown(body(md), [], { placeDocs: REFS });
	assert.match(html, /<a class="mk-place-doc-link" href="#place-knorrhuette" data-place-doc="knorrhuette">the hut<\/a>/);
	assert.match(html, /<span>the restaurant<\/span>/);
	assert.doesNotMatch(html, /place:sonnalpin/);
});

test('a place doc renders without map boxes or styles, its media after the post\'s', async () => {
	const { html, media } = await parseMarkdown(KNORR, [], { mediaOffset: 5, widgets: false, styles: false });
	assert.doesNotMatch(html, /data-hike-widget|<style>/);
	assert.match(html, /data-media-index="5"/);
	assert.match(html, /srcset="[^"]*2026-07-19-00-1280\.avif/);
	assert.equal(media.length, 1);
	assert.equal(media[0].kind, 'image');
	// A post body is unchanged: boxes and styles included, indices from 0.
	const post = await parseMarkdown(body('Text.\n\n![A](/images/a.jpg)\n'), []);
	assert.match(post.html, /data-hike-widget="map3d-mount"/);
	assert.match(post.html, /<style>/);
	assert.match(post.html, /data-media-index="0"/);
});

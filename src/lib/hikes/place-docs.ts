/**
 * Place docs on a hike post: reference text for a hut, peak, lake or town,
 * written once in `static/_projects/data-viz/hikes/places/<slug>.md` and
 * shown in every post that lists the slug under `places:`.
 *
 * This half is what the post page needs in the browser too: the shape the
 * page renders, the anchor each doc gets, and the index that finds a doc's
 * names in the post's prose so the markdown renderer can link them. Reading
 * the files (front matter, validation) is server-only, in `places.server.ts`.
 *
 * Framework-free and dependency-free, so it runs under plain Node for tests.
 */

import type { GalleryItem } from '$lib/renderers/gallery-item';
import { addPlaceName, matchTrailingWords } from './place-links';

/** What the prose renderer needs to link a doc: its slug and the names it goes by. */
export interface PlaceDocRef {
	slug: string;
	title: string;
	/** Names that refer to the place in a post's text: its title plus any `aliases`. */
	names: string[];
}

/** A place doc as the post page shows it. */
export interface RenderedPlaceDoc {
	slug: string;
	title: string;
	description: string;
	tags: string[];
	/** The doc's markdown body, rendered like a post's (images join the post's gallery). */
	html: string;
	/** Its gallery entries; their `data-media-index` continues after the post's own media. */
	media: GalleryItem[];
}

/** Element id of a doc's section on the post page, and the fragment links point at. */
export function placeDocAnchor(slug: string): string {
	return `place-${slug}`;
}

export interface PlaceDocIndex {
	/** The doc a reference's name words end with, longest run first, and where the match starts. */
	match(words: string[]): { doc: PlaceDocRef; start: number } | null;
	/** A doc by slug, for explicit `place:<slug>` links. */
	get(slug: string): PlaceDocRef | undefined;
	/** Replaces every plain mention of a doc's names in escaped HTML text (no tags) with `render`'s markup. */
	markMentions(html: string, render: (text: string) => string): string;
}

/** An index over the post's place docs, or null when it lists none. */
export function buildPlaceDocIndex(docs: PlaceDocRef[] | null | undefined): PlaceDocIndex | null {
	if (!docs?.length) return null;
	const byName = new Map<string, PlaceDocRef>();
	const bySlug = new Map<string, PlaceDocRef>();
	for (const doc of docs) {
		bySlug.set(doc.slug, doc);
		for (const name of doc.names) addPlaceName(byName, name, doc);
	}
	const mentions = mentionPattern(docs);
	return {
		match(words) {
			const hit = matchTrailingWords(words, byName);
			return hit && { doc: hit.value, start: hit.start };
		},
		get: (slug) => bySlug.get(slug),
		markMentions: (html, render) => (mentions ? html.replace(mentions.re, render) : html)
	};
}

/** Space and hyphen variants count as one: "Auer Berg" and "Auer-Berg" are one mention. */
function mentionKey(text: string): string {
	return text.replace(/(?:\s|&nbsp;|[-‐‑–])+/g, ' ');
}

/**
 * Matches a doc's names as whole words, exactly as written apart from spaces
 * and hyphens. Case counts, unlike a `Name (1234 m)` reference: a bare word
 * is too easily an ordinary one ("Gatterl" the place, not "gatterl").
 */
function mentionPattern(docs: PlaceDocRef[]): { re: RegExp } | null {
	const keys = new Set<string>();
	for (const doc of docs) {
		for (const name of doc.names) {
			const key = mentionKey(escapeAttr(name.trim()));
			if (key) keys.add(key);
		}
	}
	if (!keys.size) return null;
	// Longest first, so "Marienstein Kirche" wins over "Marienstein".
	const alternatives = [...keys]
		.sort((a, b) => b.length - a.length)
		.map((key) => key.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\s|&nbsp;|[-‐‑–])+'));
	return { re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'gu') };
}

function escapeAttr(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The small link after a place's name in the prose that jumps to its doc's
 * section further down. Separate from the name, which keeps its own link to
 * the 2D map.
 */
export function placeDocMarkerHtml(doc: PlaceDocRef): string {
	const label = escapeAttr(`About ${doc.title}`);
	return `<a class="mk-place-doc" href="#${placeDocAnchor(doc.slug)}" data-place-doc="${escapeAttr(doc.slug)}" title="${label}" aria-label="${label}" translate="no">ⓘ</a>`;
}

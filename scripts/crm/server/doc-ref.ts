import path from 'node:path';
import { ApiError } from './errors';
import { STORIES, ownFolderOf } from '../lib/image-key';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { PLACE_SLUG } from '../shared/place-slug';
import { OTHER_LANGS, type Lang } from '../../../src/lib/i18n/languages';

/** A file a translation can translate: a dated post or a place doc. */
export type SourceRef = { kind: 'post'; slug: string; date: string } | { kind: 'place'; slug: string };

/**
 * One editable doc: a dated post (with its hike's sidecar), a hike's sidecar alone, a place doc, or the translation
 * of a post or place doc into `lang` (`<source>.<lang>.md` beside it).
 */
export type DocRef = SourceRef | { kind: 'hike'; slug: string } | { kind: 'translation'; source: SourceRef; lang: Lang };

/** An English doc: anything but a translation (which has only its texts; the rest is its source's). */
export type EnglishRef = Exclude<DocRef, { kind: 'translation' }>;

export { PLACE_SLUG };

export function assertPlaceSlug(slug: string): string {
	if (typeof slug !== 'string' || !PLACE_SLUG.test(slug)) throw new ApiError(400, `Invalid place slug: ${JSON.stringify(slug)}`);
	return slug;
}

/**
 * `?place=<slug>` is a place doc, `?slug&date` a post, `?slug` alone the hike's sidecar; any of the first two with
 * `&lang=<lang>` is its translation into that language.
 */
export function refFromQuery(q: URLSearchParams): DocRef {
	const ref = sourceFromQuery(q);
	const lang = q.get('lang');
	if (lang === null) return ref;
	if (!(OTHER_LANGS as readonly string[]).includes(lang)) throw new ApiError(400, `Unknown language ${JSON.stringify(lang)} (${OTHER_LANGS.join(', ')})`);
	if (ref.kind === 'hike') throw new ApiError(400, 'A hike without a post has no translation');
	return { kind: 'translation', source: ref, lang: lang as Lang };
}

function sourceFromQuery(q: URLSearchParams): SourceRef | { kind: 'hike'; slug: string } {
	const place = q.get('place');
	if (place !== null) return { kind: 'place', slug: assertPlaceSlug(place) };
	const slug = q.get('slug');
	if (!slug) throw new ApiError(400, 'slug is required');
	assertSafeSlug(slug);
	const date = q.get('date');
	return date ? { kind: 'post', slug, date: assertSafeDate(date) } : { kind: 'hike', slug };
}

export function placePath(root: string, slug: string): string {
	return path.join(repoPaths(root).places, `${slug}.md`);
}

/** The markdown file of the doc; null for a hike (sidecar only). A translation's is `<source>.<lang>.md`. */
export function docFile(root: string, ref: DocRef): string | null {
	if (ref.kind === 'translation') return docFile(root, ref.source)!.replace(/\.md$/, `.${ref.lang}.md`);
	if (ref.kind === 'place') return placePath(root, ref.slug);
	if (ref.kind === 'post') return path.join(repoPaths(root).markdown, `${ref.date}-${ref.slug}.md`);
	return null;
}

/**
 * Folder (with trailing slash) whose images the doc keys by bare file name. A hike has no file: its posts' stories
 * folder. A translation shows its source's media, so it has its source's folder.
 */
export function ownFolder(ref: DocRef): string {
	if (ref.kind === 'translation') return ownFolder(ref.source);
	if (ref.kind === 'place') return ownFolderOf(`${ref.slug}.md`);
	if (ref.kind === 'post') return ownFolderOf(`${ref.date}-${ref.slug}.md`);
	return `${STORIES}${ref.slug}/`;
}

/**
 * `withDocLock` key: a hike's sidecar and all its posts share one lock; a place doc of the same slug has its own. A
 * translation takes its source's.
 */
export function lockKey(ref: DocRef): string {
	if (ref.kind === 'translation') return lockKey(ref.source);
	return ref.kind === 'place' ? `place:${ref.slug}` : `post:${ref.slug}`;
}

/** The doc's key in immich-links.json: the post file name, or `places/<slug>.md`; a hike (no file) has none. */
export function linksKey(ref: DocRef): string {
	if (ref.kind === 'translation') throw new ApiError(400, 'A translation has no photos of its own');
	if (ref.kind === 'place') return `places/${ref.slug}.md`;
	if (ref.kind === 'post') return `${ref.date}-${ref.slug}.md`;
	throw new ApiError(400, 'A hike without a post has no photos');
}

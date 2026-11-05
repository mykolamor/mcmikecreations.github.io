/**
 * Server-only: the blog's markdown folder turned into posts and their translations. No Vite globs here
 * (`blog-posts.server.ts` globs `static/_blog/`), so it runs under plain Node for tests.
 *
 * A translation is `<date>-<slug>.<lang>.md` beside the English post, as for hikes
 * (`$lib/hikes/translations.server`): front matter `title`, `description` and `section`, each optional, then the
 * whole translated body. Date, tags, author and images stay the English post's. A translation is never a post of
 * its own: it isn't listed, in a feed or the search index, and has no URL.
 */

import matter from 'gray-matter';
import {
	collectTranslations,
	splitTranslations,
	type ParsedTranslation,
	type TranslationsBySource
} from '$lib/hikes/translations.server';

export interface BlogPostMeta {
	title: string;
	date: string;
	image: string | null;
	imageFull: string | null;
	description: string;
	author: string | null;
	tags: string[];
	/**
	 * `article:section` / `articleSection`: the front-matter `section`, else the
	 * first tag, else null (the tag is then omitted).
	 */
	section: string | null;
	/** Front-matter `updated: YYYY-MM-DD` override for `dateModified`, raw. */
	updated: unknown;
	draft: boolean;
	/** File name, e.g. `2024-03-01-ecs.md`. */
	path: string;
	/** File name without extension, e.g. `2024-03-01-ecs` — the URL slug. */
	anchor: string;
}

/** Coerce a front-matter date to a `YYYY-MM-DD` string, tolerating YAML Dates. */
function toDateString(value: unknown): string {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return typeof value === 'string' ? value : String(value ?? '');
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The posts' metadata, newest first, and their translations by English file name. */
export interface BlogIndex {
	posts: BlogPostMeta[];
	translations: TranslationsBySource;
}

/**
 * Builds the index from the folder's markdown by file name (`2024-03-01-ecs.md`, `2024-03-01-ecs.de.md`). Throws,
 * naming the file, on a translation the site can't read (see `collectTranslations`); `mediaExists` is for tests.
 */
export function buildBlogIndex(
	files: Record<string, string>,
	opts: { mediaExists?: (servedPath: string) => boolean } = {}
): BlogIndex {
	const { docs, translations } = splitTranslations(files);
	const posts = Object.entries(docs)
		.map(([path, raw]): BlogPostMeta => {
			const { data } = matter(raw);
			const anchor = path.replace(/\.md$/, '');
			const tags: string[] = Array.isArray(data.tags) ? data.tags.map(String) : [];
			return {
				title: typeof data.title === 'string' ? data.title : anchor,
				date: toDateString(data.date),
				image: toStringOrNull(data.image),
				imageFull: toStringOrNull(data.imageFull),
				description: typeof data.description === 'string' ? data.description : '',
				author: toStringOrNull(data.author),
				tags,
				section: toStringOrNull(data.section) ?? tags[0] ?? null,
				updated: data.updated,
				draft: data.draft === true,
				path,
				anchor
			};
		})
		.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
	return {
		posts,
		translations: collectTranslations('blog', translations, new Set(Object.keys(docs)), opts.mediaExists ? { mediaExists: opts.mediaExists } : {})
	};
}

/** A post's translation into `lang` (`anchor` without `.md`), or undefined. */
export function translationIn(index: BlogIndex, anchor: string, lang: string): ParsedTranslation | undefined {
	return (index.translations.get(`${anchor}.md`) as Record<string, ParsedTranslation> | undefined)?.[lang];
}

/** The languages a post is translated into, sorted; English not included. */
export function translationLangsOf(index: BlogIndex, anchor: string): string[] {
	return Object.keys(index.translations.get(`${anchor}.md`) ?? {}).sort();
}

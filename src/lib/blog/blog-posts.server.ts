/**
 * Server-only source of truth for blog posts.
 *
 * A post with `draft: true` (or a file that omits the flag but was never a real
 * post) is invisible: excluded from every listing, feed, and search index here.
 */

import type { ProcessedBlogPost } from './blog-info';
import type { Lang } from '$lib/i18n/languages';
import type { ParsedTranslation } from '$lib/hikes/translations.server';
import { buildBlogIndex, translationIn, translationLangsOf, type BlogPostMeta } from './blog-index.server';

export type { BlogPostMeta };

// Raw markdown for every post and translation, keyed by glob path, inlined into the bundle.
const rawFiles = import.meta.glob('/static/_blog/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

/** Parsed once, at module load (build time); a translation the site can't read fails the build. */
const index = buildBlogIndex(
	Object.fromEntries(Object.entries(rawFiles).map(([key, raw]) => [key.substring(key.lastIndexOf('/') + 1), raw]))
);
const allMeta: BlogPostMeta[] = index.posts;

/**
 * A post's translation into `lang` (title, description, section and body), or undefined. Drafts' translations
 * included, as `getBlogPostMeta` includes drafts. For the future `/de/blog/` routes and the sitemap.
 */
export function getBlogTranslation(anchor: string, lang: Lang): ParsedTranslation | undefined {
	return translationIn(index, anchor, lang);
}

/** The languages a post is translated into (English not included). */
export function getBlogTranslationLangs(anchor: string): Lang[] {
	return translationLangsOf(index, anchor) as Lang[];
}

/** Full metadata for a single post by file name, or undefined. Includes drafts. */
export function getBlogPostMeta(path: string): BlogPostMeta | undefined {
	return allMeta.find(m => m.path === path);
}

/** All published (non-draft) posts' raw metadata, newest first. */
export function getAllBlogMeta(): BlogPostMeta[] {
	return allMeta.filter(m => !m.draft);
}

export function getAllBlogPosts(): ProcessedBlogPost[] {
	return getAllBlogMeta().map(m => {
		const date = new Date(m.date);
		return {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			day: date.getDate(),
			date,
			url: `/blog/${m.anchor}/`,
			title: m.title,
			image: m.image,
			description: m.description,
			tags: m.tags,
			anchor: m.anchor
		};
	});
}

interface BlogParams {
	page?: number;
	tag?: string;
	year?: number;
	limit?: number;
}

export const defaultPageSize = 10;

export function getBlogPosts({ page = 1, tag, year, limit = defaultPageSize }: BlogParams) {
	let posts = getAllBlogPosts();

	if (tag) {
		posts = posts.filter(p => p.tags.includes(tag));
	}

	if (year) {
		posts = posts.filter(p => p.year === year);
	}

	const totalPosts = posts.length;
	const totalPages = Math.max(1, Math.ceil(totalPosts / limit));
	const startIndex = (page - 1) * limit;
	const endIndex = startIndex + limit;
	const visiblePosts = posts.slice(startIndex, endIndex);

	return {
		posts: visiblePosts,
		pagination: {
			currentPage: page,
			totalPages,
			totalPosts,
			hasNext: page < totalPages,
			hasPrev: page > 1,
			nextPage: page < totalPages ? page + 1 : null,
			prevPage: page > 1 ? page - 1 : null
		}
	};
}

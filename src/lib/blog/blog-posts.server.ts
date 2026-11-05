/**
 * Server-only source of truth for blog posts.
 *
 * A post with `draft: true` (or a file that omits the flag but was never a real
 * post) is invisible: excluded from every listing, feed, and search index here.
 */

import matter from 'gray-matter';
import type { ProcessedBlogPost } from './blog-info';

// Raw markdown for every post, keyed by glob path, inlined into the bundle.
const rawFiles = import.meta.glob('/static/_blog/*.md', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

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

/** Parse every markdown file's front matter once, at module load (build time). */
const allMeta: BlogPostMeta[] = Object.entries(rawFiles)
	.map(([key, raw]) => {
		const { data } = matter(raw);
		const path = key.substring(key.lastIndexOf('/') + 1);
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

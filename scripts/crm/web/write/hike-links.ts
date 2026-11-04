/**
 * `[[` links to other posts: the search over every post (`GET /api/hikes`) and
 * the text change, free of CodeMirror. A typed `[[` is replaced by the link;
 * from the toolbar it goes in at the cursor.
 */
import { normalizePlaceName } from '$lib/hikes/place-links';
import { hikeLinkInsert, type MdChange } from '../../shared/md-lines';
import type { HikeRow } from '../../server/hikes-index';
import { captionText } from './media-chips';

export type HikePost = { title: string; date: string; slug: string };

/** Every post of every hike, newest first. */
export function hikePosts(hikes: (Pick<HikeRow, 'slug'> & { posts: Pick<HikeRow['posts'][number], 'title' | 'date'>[] })[]): HikePost[] {
	return hikes
		.flatMap((h) => h.posts.map((p) => ({ title: p.title, date: p.date, slug: h.slug })))
		.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/** Lowercase, accents and `ß` folded, hyphens as spaces: "Über" finds "uber", "2023-05" finds the date. */
const fold = (s: string) => normalizePlaceName(s);

/** The posts whose title, date or slug hold every word of `query` (one character is enough); none for an empty query. */
export function searchHikes(posts: HikePost[], query: string, max = 20): HikePost[] {
	const words = fold(query).split(' ').filter(Boolean);
	if (!words.length) return [];
	return posts.filter((p) => {
		const hay = fold(`${p.title} ${p.date} ${p.slug} ${p.slug.replace(/_/g, ' ')}`);
		return words.every((w) => hay.includes(w));
	}).slice(0, max);
}

/** Where a `[[` the author just typed starts (the input ended it at `head`), or null. */
export function typedLinkStart(doc: string, head: number, inserted: string): number | null {
	return inserted.endsWith('[') && head >= 2 && doc.slice(head - 2, head) === '[[' ? head - 2 : null;
}

/**
 * The link to `post`: over the `[[` at `typed` when it is still there, else at `pos`. The title (brackets escaped, so
 * one can't end the link text) ends up selected.
 */
export function hikeLinkChange(body: string, pos: number, post: HikePost, typed: number | null): MdChange {
	const title = captionText(post.title);
	if (typed !== null && body.slice(typed, typed + 2) === '[[') return { ...hikeLinkInsert(typed, title, post.date, post.slug), to: typed + 2 };
	return hikeLinkInsert(pos, title, post.date, post.slug);
}

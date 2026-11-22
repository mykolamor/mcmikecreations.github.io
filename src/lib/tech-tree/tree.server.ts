/**
 * Server-only: the blog index turned into laid-out SmackDB tech tree timelines. Shared by the page's load and the
 * guard test that the real posts' `techTree` data builds.
 */

import { translationIn, type BlogIndex } from '$lib/blog/blog-index.server';
import { OTHER_LANGS } from '$lib/i18n/languages';
import { buildTechTree, type Titles, type TreePostInput } from './model';
import { layoutTimeline, type TimelineLayout } from './layout';
import { TIMELINES } from './timelines';

export function techTreeLayouts(index: BlogIndex): TimelineLayout[] {
	const posts: TreePostInput[] = index.posts.map((p) => {
		const titles: Titles = { en: p.title };
		for (const lang of OTHER_LANGS) {
			const title = translationIn(index, p.anchor, lang)?.title;
			if (title) titles[lang] = title;
		}
		return { anchor: p.anchor, path: p.path, draft: p.draft, tags: p.tags, titles, techTree: p.techTree };
	});
	const pathOf = new Map(posts.map((p) => [p.anchor, p.path]));
	return buildTechTree(posts, TIMELINES).timelines.map((tl) => layoutTimeline(tl, (a) => pathOf.get(a) ?? a));
}

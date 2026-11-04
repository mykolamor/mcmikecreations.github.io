/**
 * The `/hikes/` pages' titles and descriptions, and a tag's own strings
 * (`tags.<Tag>` in the string tables). The texts live in `i18n/en.json`.
 */

import { TABLES, t } from '$lib/i18n/strings';
import type { Lang } from '$lib/i18n/languages';

export const HIKES_BLOG_TITLE = t('en', 'meta.blogTitle');
export const HIKES_BLOG_DESCRIPTION = t('en', 'meta.blogDescription');
export const HIKES_HERO_IMAGE = '/images/hikes/hero/hike_poster_4_bg_2.png';

export const hikePostTitle = (title: string) => t('en', 'meta.postTitle', { title });

export const hikesListTitle = (page: number) => t('en', 'meta.listTitle', { page });

export const hikesListDescription = (page: number) => t('en', 'meta.listDescription', { page });

export const hikesTagTitle = (tag: string, page: number) =>
	t('en', 'meta.tagTitle', { tag: tagLabel('en', tag), page });

export const hikesTagDescription = (tag: string, page: number) =>
	t('en', 'meta.tagDescription', { tag: tagLabel('en', tag), page });

export const hikesYearTitle = (year: number, page: number) => t('en', 'meta.yearTitle', { year, page });

export const hikesYearDescription = (year: number, page: number) => t('en', 'meta.yearDescription', { year, page });

/** A tag with its own strings: a page title and description, a breadcrumb, a heading and an intro. */
function hasStrings(tag: string): boolean {
	return Object.hasOwn(TABLES.en.tags, tag);
}

/** The tag's name as shown; a tag without its own strings shows as itself. */
export function tagLabel(lang: Lang, tag: string): string {
	return hasStrings(tag) ? t(lang, `tags.${tag}.label`) : tag;
}

/** The tag's own page title, description and breadcrumb, or undefined for a tag without them. */
export function tagStrings(lang: Lang, tag: string) {
	if (!hasStrings(tag)) return undefined;
	return {
		title: t(lang, `tags.${tag}.title`),
		description: t(lang, `tags.${tag}.description`),
		breadcrumb: t(lang, `tags.${tag}.breadcrumb`)
	};
}

/**
 * The blog's `images` front matter (written by `pnpm crm blog-images`): per image href, its size, blur and
 * optional `alt`. Read by `BlogImage.svelte` through context and by the post's hero.
 */

import type { HikeImageMeta } from '$lib/renderers/responsive-image';

export type BlogImages = Record<string, HikeImageMeta>;

/** Context key: the value is a getter, so navigating between posts sees the new post's map. */
export const BLOG_IMAGES = Symbol('blog-images');

/** `sizes` for blog images: full width on phones, the prose column (at most ~45rem) above. */
export const BLOG_IMAGE_SIZES = '(min-width: 1024px) 45rem, 100vw';

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The front matter's `images` map, keeping only entries that are maps; anything else gives `{}`. */
export function readBlogImages(raw: unknown): BlogImages {
	if (!isPlainObject(raw)) return {};
	const out: BlogImages = {};
	for (const [k, v] of Object.entries(raw)) if (isPlainObject(v)) out[k] = v as unknown as HikeImageMeta;
	return out;
}

/**
 * The `alt` of a body image whose markdown text is its `<figcaption>`: the entry's own `alt` when it says something
 * the caption doesn't, else empty, so a screen reader doesn't hear the caption twice.
 */
export function blogImageAlt(caption: string, meta: HikeImageMeta | undefined): string {
	const alt = typeof meta?.alt === 'string' ? meta.alt.trim() : '';
	return alt && alt !== caption.trim() ? alt : '';
}

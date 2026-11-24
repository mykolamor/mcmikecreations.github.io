/**
 * A hike post's header image as a responsive picture: the AVIF tiers, size and
 * blur that `pnpm crm images` writes into the post's `images` front matter
 * under the image's full href. One image can head several posts (a sidecar's),
 * so any post's entry serves them all. Browser-safe: the index is built from
 * front matter the server hands in (`headerPicture` in `hikes.server.ts`).
 */

import { responsivePicture, type HikeImageMeta, type ResponsivePicture } from '$lib/renderers/responsive-image';

export type HeaderImageIndex = Map<string, HikeImageMeta>;

/** Every full-href (`/images/…`) `images` entry with a blur, across the given front matters; the first one wins. */
export function indexHeaderImages(frontmatters: Iterable<Record<string, unknown> | undefined>): HeaderImageIndex {
	const index: HeaderImageIndex = new Map();
	for (const fm of frontmatters) {
		const images = fm?.images as Record<string, HikeImageMeta> | undefined;
		if (!images || typeof images !== 'object') continue;
		for (const [key, meta] of Object.entries(images)) {
			if (key.startsWith('/images/') && meta?.blur && !index.has(key)) index.set(key, meta);
		}
	}
	return index;
}

/** The header image's picture, or null without tiers (the thumb is shown then). */
export function headerPictureFrom(href: string | null | undefined, index: HeaderImageIndex): ResponsivePicture | null {
	if (!href) return null;
	return responsivePicture(href, index.get(href.trim()));
}

/**
 * `sizes` for the hero's cover-fitted photo: the full width, or more when the
 * box's height times the photo's shape is wider (always on a portrait phone),
 * so the browser never picks a tier the crop then blows up. The heights mirror
 * `HikePostHero.svelte`'s `min-h-[85svh] md:min-h-[min(80svh,52rem)]`.
 */
export function heroSizes(width: number, height: number): string {
	const a = Math.round((width / height) * 1000) / 1000;
	return `(max-width: 767px) max(100vw, calc(85svh * ${a})), max(100vw, calc(min(80svh, 52rem) * ${a}))`;
}

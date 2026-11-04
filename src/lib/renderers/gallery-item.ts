/**
 * One entry in the fullscreen media gallery.
 */

import type { PhotoPin } from '$lib/hikes/photo-pins';

interface GalleryItemBase {
	/** Plain text alternative. */
	alt: string;
	/** Real `title` attribute. */
	title?: string;
	/** Inline HTML of the figure's caption; captions may contain links. */
	captionHtml?: string;
}

export interface GalleryImage extends GalleryItemBase {
	kind: 'image';
	src: string;
	/** Low resolution stand-in, shown blurred until `src` has loaded. */
	placeholder?: string;
	/** Small real image for the thumbnail strip — sharper than `placeholder`, much lighter than `src`. */
	thumb?: string;
	/** Where the photo was taken; pins it on the post's 2D map, and on the 3D map when `demEle` is known. */
	location?: { lat: number; lon: number; demEle?: number };
	/** When it was taken (see `HikeImageMeta.taken`); places it along the route. */
	taken?: string;
	/** Places marked on the photo; drawn over it in the gallery too. */
	pins?: PhotoPin[];
}

export interface GalleryVideo extends GalleryItemBase {
	kind: 'video';
	src: string;
	/** Mirrors the `autoplay` media flag: play muted once this slide is active. */
	autoplay: boolean;
}

export interface GalleryYoutube extends GalleryItemBase {
	kind: 'youtube';
	videoId: string;
	/** Original watch URL, kept so a slide can still link out. */
	href: string;
	/** Self-hosted poster (largest AVIF tier), when `pnpm crm video-meta` made one; else YouTube's. */
	poster?: string;
	/** Smallest poster tier, for the thumbnail strip. */
	thumb?: string;
	placeholder?: string;
	/** From the post's `videos` front matter, for the VideoObject structured data; `description` is the English one. */
	uploadDate?: string;
	duration?: string;
	description?: string;
	/** Not public; the link still renders, but no structured data. */
	unavailable?: boolean;
}

export type GalleryItem = GalleryImage | GalleryVideo | GalleryYoutube;

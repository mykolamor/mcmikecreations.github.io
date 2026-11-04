/**
 * Responsive AVIF tier math for hike post inline images, shared with
 * `pnpm crm images` (scripts/crm/lib/images.ts): tiers scale by
 * the LONG EDGE (larger of width/height), not by a fixed target width, so
 * a portrait photo's "2560" tier is 2560px tall and proportionally
 * narrower — not 2560px wide with an even taller height.
 */

import type { PhotoPin } from '$lib/hikes/photo-pins';

/** One matched or unmatched image's entry in a post's `images` front matter. */
export interface HikeImageMeta {
	w: number;
	h: number;
	/** Places marked on the photo (`photo-pins.ts`), validated server-side. */
	pins?: PhotoPin[];
	/** Set by the tools when the photo was replaced with another shape after pinning. */
	pinsReview?: boolean;
	/** Where the photo was taken (from the matched Immich asset's EXIF), when known. */
	lat?: number;
	lon?: number;
	/**
	 * Terrain height (m) under lat/lon as the post's 3D map renders it
	 * (`pnpm crm terrain`); pins the photo onto the 3D map.
	 */
	demEle?: number;
	/**
	 * When the photo was taken, local wall clock with offset
	 * (`2026-09-27T11:18:16+02:00`), vetted by `pnpm crm photo-times`.
	 */
	taken?: string;
	/** `track`: `lat`/`lon` are the recorded track's position at `taken`, not the photo's own GPS. */
	located?: 'track';
	/** Present only for images with generated AVIF tiers. */
	blur?: string;
	/** Alt text for the `<img>`, when it should differ from the caption (`scripts/crm`). */
	alt?: string;
}

/**
 * One embedded YouTube video's entry in a post's `videos` front matter,
 * keyed by video id. Written by `pnpm crm video-meta`; the poster lives at
 * `videoPosterHref(id)` with AVIF tiers beside it.
 */
export interface HikeVideoMeta {
	/** YouTube's title by language (`en`, `de`, `uk`): the uploader's translations. */
	title?: Record<string, string>;
	/** ISO 8601 with offset, `2025-08-03T07:30:07-07:00`. */
	uploadDate?: string;
	/** ISO 8601 duration, `PT36M42S`. */
	duration?: string;
	/** First paragraph of YouTube's description by language; hand edits are kept. */
	description?: Record<string, string>;
	/** Poster dimensions; present with `blur` once the poster is on disk. */
	w?: number;
	h?: number;
	blur?: string;
	/** Not public (private or removed): no poster, no structured data. */
	unavailable?: boolean;
}

export const VIDEO_POSTERS_PREFIX = '/images/projects/data-viz/hikes/videos/';

/** The self-hosted poster JPEG of a YouTube video. */
export function videoPosterHref(videoId: string): string {
	return `${VIDEO_POSTERS_PREFIX}${videoId}.jpg`;
}

/** One AVIF tier's actual generated dimensions. */
export interface AvifTier {
	/** The long-edge target this tier was generated at (640/1280/2560) — also the number in its filename. */
	target: number;
	width: number;
	height: number;
}

export const AVIF_TIERS: readonly number[] = [640, 1280, 2560];

/**
 * Output (width, height) for one tier, or null if it would upscale.
 * `pnpm crm images` writes the tiers with this same function.
 */
export function tierDimensions(
	w: number,
	h: number,
	target: number
): { width: number; height: number } | null {
	if (w <= 0 || h <= 0) return null;
	if (w >= h) {
		if (target > w) return null;
		return { width: target, height: Math.round((target * h) / w) };
	}
	if (target > h) return null;
	return { width: Math.round((target * w) / h), height: target };
}

/** Every AVIF_TIERS entry that fits `w`x`h` without upscaling, ascending. */
export function avifTiers(w: number, h: number): AvifTier[] {
	const out: AvifTier[] = [];
	for (const target of AVIF_TIERS) {
		const dims = tierDimensions(w, h, target);
		if (dims) out.push({ target, ...dims });
	}
	return out;
}

/** `.../2026-08-23-00.jpg` + 1280 -> `.../2026-08-23-00-1280.avif`. */
export function avifVariantHref(href: string, target: number): string {
	const dot = href.lastIndexOf('.');
	const base = dot === -1 ? href : href.slice(0, dot);
	return `${base}-${target}.avif`;
}

/** A `srcset` value listing every tier's AVIF variant with its actual width. */
export function buildAvifSrcset(href: string, tiers: AvifTier[]): string {
	return tiers.map((t) => `${avifVariantHref(href, t.target)} ${t.width}w`).join(', ');
}

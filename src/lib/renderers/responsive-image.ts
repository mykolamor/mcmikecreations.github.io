/**
 * Responsive AVIF tier math for hike post inline images, mirroring
 * scripts/matches/optimize.py's tier_dimensions exactly: tiers scale by
 * the LONG EDGE (larger of width/height), not by a fixed target width, so
 * a portrait photo's "2560" tier is 2560px tall and proportionally
 * narrower — not 2560px wide with an even taller height.
 */

/** One matched or unmatched image's entry in a post's `images` front matter. */
export interface HikeImageMeta {
	w: number;
	h: number;
	/** Present only for images with generated AVIF tiers. */
	blur?: string;
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
 * Must stay in lockstep with scripts/matches/optimize.py's tier_dimensions.
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

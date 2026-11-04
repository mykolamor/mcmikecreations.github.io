import type { HikeImageMeta } from './responsive-image';

/**
 * Looks up image metadata: an exact key match on the full `href` wins (e.g. a
 * `/images/hikes/topo/x.jpg` key), then the basename (the usual per-hike key).
 */
export function imageMetaFor(images: Record<string, HikeImageMeta>, href: string): HikeImageMeta | undefined {
	const trimmed = href.trim();
	if (Object.hasOwn(images, trimmed)) return images[trimmed];
	const base = trimmed.split('/').pop() ?? '';
	return Object.hasOwn(images, base) ? images[base] : undefined;
}

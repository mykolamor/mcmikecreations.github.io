/**
 * One entry in the fullscreen media gallery.
 */

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
}

export type GalleryItem = GalleryImage | GalleryVideo | GalleryYoutube;

<script lang="ts">
	import { getContext } from 'svelte';
	import DefaultImage from '$lib/renderers/DefaultImage.svelte';
	import { imageMetaFor } from '$lib/renderers/image-meta';
	import { BLOG_IMAGES, BLOG_IMAGE_SIZES, blogImageAlt, type BlogImages } from '$lib/blog/blog-images';

	/**
	 * The blog's markdown image renderer: `DefaultImage` with the post's `images` entry (AVIF `<picture>`, size,
	 * blur) and an `alt` that doesn't repeat the caption.
	 */
	interface Props {
		href?: string;
		title?: any;
		text?: string;
	}

	let { href = '', title = undefined, text = '' }: Props = $props();
	const images = getContext<(() => BlogImages) | undefined>(BLOG_IMAGES);
	const local = $derived(href.trim().startsWith('/') && !href.trim().startsWith('//'));
	const meta = $derived(local ? imageMetaFor(images?.() ?? {}, href) : undefined);
</script>

<DefaultImage {href} {title} {text} alt={blogImageAlt(text, meta)} {meta} sizes={BLOG_IMAGE_SIZES} />

<script lang="ts">
	import type { ResponsivePicture } from '$lib/renderers/responsive-image';

	/**
	 * A local raster image as `<picture>`: AVIF tiers, the original as fallback, intrinsic size, and the blur
	 * placeholder underneath until it loads. `eager` is for an above-the-fold image (the post's hero).
	 */
	interface Props {
		picture: ResponsivePicture;
		alt: string;
		title?: string;
		sizes: string;
		eager?: boolean;
		/** Classes on the box (border, width, margins). */
		class?: string;
		/** Classes on the `<img>` itself (`dark:invert`, cursor). */
		imgClass?: string;
		onclick?: (e: MouseEvent) => void;
	}

	let { picture, alt, title = undefined, sizes, eager = false, class: boxClass = '', imgClass = '', onclick = undefined }: Props = $props();
	let loaded = $state(false);
</script>

<span class="relative block overflow-hidden {boxClass}" style="aspect-ratio:{picture.width}/{picture.height}">
	{#if !loaded}
		<img src={picture.blur} alt="" aria-hidden="true" class="absolute inset-0 !m-0 h-full w-full scale-105 object-cover blur-md" />
	{/if}
	<picture class="!m-0 block">
		<source type="image/avif" srcset={picture.srcset} {sizes} />
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<img
			src={picture.src}
			{alt}
			{title}
			width={picture.width}
			height={picture.height}
			loading={eager ? 'eager' : 'lazy'}
			fetchpriority={eager ? 'high' : undefined}
			decoding="async"
			class="relative !m-0 block h-auto w-full {imgClass}"
			onload={() => (loaded = true)}
			{onclick}
		/>
	</picture>
</span>

<script lang="ts">
	/**
	 * A hike's header image on a card (the post lists, search results, the
	 * data-viz index): the AVIF tiers when `pnpm crm images` has made them, so
	 * the browser picks the one the card and the screen's density need; the
	 * 400px thumb otherwise, and for browsers without AVIF.
	 */
	interface Props {
		/** The thumb (`/images/…/hikes/thumb/x.jpg`). */
		src: string;
		/** The tiers' `srcset`, from the header image's picture. */
		srcset?: string | null;
		/** How wide the card shows it, as a `sizes` value. */
		sizes: string;
		alt?: string;
		/** For the cards above the fold: loaded at once, not when scrolled near. */
		eager?: boolean;
		/** Classes on the `<img>` (fit, rounding, hover zoom). */
		class?: string;
	}

	let { src, srcset = null, sizes, alt = '', eager = false, class: className = '' }: Props = $props();
	const loading = $derived(eager ? 'eager' : 'lazy');
</script>

{#if srcset}
	<picture class="contents">
		<source type="image/avif" {srcset} {sizes} />
		<img {src} {alt} {loading} decoding="async" class={className} />
	</picture>
{:else}
	<img {src} {alt} {loading} decoding="async" class={className} />
{/if}

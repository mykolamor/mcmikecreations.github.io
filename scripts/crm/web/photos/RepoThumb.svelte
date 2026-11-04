<script lang="ts">
	import { avifVariantHref } from '$lib/renderers/responsive-image';

	// A repo image: its smallest AVIF tier, or the original when there are no tiers (small library images).
	let { href, alt = '', size = 64 }: { href: string; alt?: string; size?: number } = $props();
	// The href whose tier failed to load: a new href starts from its tier again, no reset needed.
	let failedFor = $state<string | null>(null);
	let src = $derived(failedFor === href ? href : avifVariantHref(href, 640));
</script>

<!-- keyed: a new href starts again from the tier -->
{#key href}
	<img {src} {alt} width={size} height={Math.round(size * 0.75)} loading="lazy" onerror={() => (failedFor = href)} />
{/key}

<style>
	img {
		object-fit: cover;
		border-radius: 4px;
		background: #ddd;
		flex: none;
	}
</style>

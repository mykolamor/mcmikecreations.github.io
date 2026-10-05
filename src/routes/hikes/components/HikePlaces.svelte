<script lang="ts">
	// The post's place docs ("Places on this route"): reference text for huts,
	// peaks and towns written once and shown in every post that lists them
	// under `places:`. Each is collapsed until opened, or until a link in the
	// story (the ⓘ after a place's name) points at it.
	import { placeDocAnchor, type RenderedPlaceDoc } from '$lib/hikes/place-docs';

	interface Props {
		places: RenderedPlaceDoc[];
	}

	let { places }: Props = $props();
</script>

<section class="mt-8" aria-labelledby="places-heading" data-place-docs>
	<h2 id="places-heading">Places on this route</h2>
	{#each places as place (place.slug)}
		<details
			id={placeDocAnchor(place.slug)}
			class="my-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 scroll-mt-20"
		>
			<summary class="cursor-pointer list-none flex items-baseline gap-2 py-1">
				<span class="flex flex-col gap-0.5">
					<span class="font-semibold text-gray-900 dark:text-white" translate="no">{place.title}</span>
					<span class="text-base text-gray-600 dark:text-gray-400">{place.description}</span>
				</span>
			</summary>
			{#if place.tags.length}
				<div class="not-prose flex flex-wrap gap-2 mt-2">
					{#each place.tags as tag}
						<span class="text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 px-2.5 py-0.5 rounded-sm">{tag}</span>
					{/each}
				</div>
			{/if}
			<div>
				{@html place.html}
			</div>
		</details>
	{/each}
</section>

<style>
	summary::-webkit-details-marker {
		display: none;
	}
	summary::before {
		content: '▸';
		font-size: 0.8em;
		color: rgb(107 114 128);
		transition: transform 150ms ease;
	}
	details[open] > summary::before {
		transform: rotate(90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		summary::before {
			transition: none;
		}
	}
</style>

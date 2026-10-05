<script lang="ts">
	// Where on the route something applies: a single place, or a stretch
	// `from – to` (either end may be open).
	import type { Lang, Place } from '$lib/hikes/facts-schema';
	import FactsPlace from './FactsPlace.svelte';

	interface Props {
		lang: Lang;
		at?: Place;
		from?: Place;
		to?: Place;
	}

	let { lang, at, from, to }: Props = $props();
</script>

{#if at}<FactsPlace place={at} {lang} />{:else if from && to}<FactsPlace place={from} {lang} /> – <FactsPlace
		place={to}
		{lang}
	/>{:else if from}<FactsPlace place={from} {lang} /> →{:else if to}→ <FactsPlace place={to} {lang} />{/if}

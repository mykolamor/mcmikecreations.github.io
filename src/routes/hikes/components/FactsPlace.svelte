<script lang="ts">
	// A place named in the facts layer: a link that centers the 2D map on it
	// (wired up with the prose's place links, by `a.mk-place`), with its
	// elevation and distance along the route when known.
	import { textIn, type Lang, type Place } from '$lib/hikes/facts-schema';
	import { formatKm } from '$lib/hikes/facts-format';

	interface Props {
		place: Place;
		lang: Lang;
		/** Show `km 7.5` after the name. */
		km?: boolean;
	}

	let { place, lang, km = false }: Props = $props();
	const name = $derived(textIn(place.name, lang));
</script>

<span translate="no" class="whitespace-nowrap">{#if place.lat != null && place.lon != null}<a
			class="mk-place"
			href="#hike-map"
			data-place-lat={place.lat}
			data-place-lon={place.lon}
			title="Show on the map">{name}</a>{:else}{name}{/if}{#if place.ele != null}&nbsp;({place.ele}&nbsp;m){/if}</span>{#if km && place.km != null}<span class="text-gray-500 dark:text-gray-400 tabular-nums" translate="no">&nbsp;· {formatKm(place.km)}</span>{/if}

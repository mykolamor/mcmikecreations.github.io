<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { rankPlaces, searchOsm, searchStore, type LatLon, type PlaceItem } from './pin-ops';

	let {
		photo,
		origin,
		hikeNodes,
		onpick,
		oncancel
	}: {
		/** The photo's position: search near it, distances from it. */
		photo: LatLon | null;
		/** The hike's map origin: used when the photo has no position. */
		origin: LatLon | null;
		/** The hike's own nodes (listed first, before typing, and first without a photo position). */
		hikeNodes: PlaceItem[];
		onpick: (item: PlaceItem) => void;
		oncancel: () => void;
	} = $props();

	let q = $state('');
	let found = $state<PlaceItem[] | null>(null);
	let loading = $state(false);
	let osmLoading = $state(false);
	/** OpenStreetMap has answered for the current text. */
	let osmAsked = $state(false);
	let error = $state<string | null>(null);
	let osmError = $state<string | null>(null);
	let hi = $state(0);
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let gen = 0;
	/** The text the shown results are for. */
	let searched = '';

	let items = $derived(rankPlaces(found ?? hikeNodes, photo, origin, hikeNodes.map((n) => n.ref)));

	// The store (osm.json) is searched while typing; OpenStreetMap only on its button.
	async function search() {
		clearTimeout(timer);
		const text = q.trim();
		const mine = ++gen;
		hi = 0;
		searched = text;
		osmLoading = osmAsked = false;
		error = osmError = null;
		if (!text) {
			found = null;
			loading = false;
			return;
		}
		loading = true;
		try {
			const items = await searchStore(text);
			if (mine !== gen) return;
			found = items;
		} catch (e) {
			if (mine !== gen) return;
			found = [];
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (mine === gen) loading = false;
		}
	}
	async function askOsm() {
		const text = q.trim();
		if (!text) return;
		input.focus(); // the button is disabled while this runs, and the picker's keys live on the input
		if (text !== searched) await search();
		if (q.trim() !== text) return;
		const mine = ++gen;
		osmLoading = true;
		osmError = null;
		// OSM is searched by name near the photo, else near the hike's origin.
		const r = await searchOsm(text, photo ?? origin, found ?? []);
		if (mine !== gen) return;
		// OSM's results re-sort the list: the highlight stays on its place, so Enter can't pick another one.
		const current = items[hi]?.ref;
		found = r.items;
		hi = Math.max(0, items.findIndex((it) => it.ref === current));
		osmError = r.osmError;
		osmLoading = false;
		osmAsked = true;
	}
	function typed() {
		clearTimeout(timer);
		gen++; // drop answers for the old text
		loading = osmLoading = false;
		timer = setTimeout(() => void search(), 400);
	}
	onMount(() => input.focus());
	onDestroy(() => (clearTimeout(timer), gen++));

	function onkeydown(e: KeyboardEvent) {
		// The editor's own keys (arrows nudge, Del removes, Esc closes) must not see these.
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (items.length) hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (q.trim() !== searched) void search();
			else if (items[hi] && !loading) onpick(items[hi]);
		}
	}
</script>

<div class="picker" role="group" aria-label="Choose a place for this pin">
	<input
		bind:this={input}
		bind:value={q}
		oninput={typed}
		{onkeydown}
		type="search"
		placeholder="Search a place, or paste node/123 or an OSM link"
		aria-label="Search place for this pin"
		autocomplete="off"
	/>
	<ul role="listbox" aria-label="Places">
		{#each items as it, i (it.ref)}
			<li role="option" aria-selected={i === hi}>
				<button type="button" class:hi={i === hi} onclick={() => onpick(it)} onpointerenter={() => (hi = i)}>
					<span class="name">{it.name ?? it.ref}{#if !it.inStore}<span class="new"> · from OSM</span>{/if}</span>
					<span class="dist">{it.label}</span>
				</button>
			</li>
		{:else}
			<li class="none">{loading ? 'Searching…' : osmLoading ? 'Searching OpenStreetMap (can take a minute when Overpass is busy)…' : !found ? 'Type to search the store' : osmAsked ? 'Nothing found' : 'Not in the store. Try Search OpenStreetMap.'}</li>
		{/each}
	</ul>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	{#if osmError}<p class="err">OSM: {osmError}</p>{/if}
	<div class="foot">
		<span>{!found ? 'Hike nodes' : osmLoading ? 'Store · searching OSM…' : osmAsked ? 'Store and OSM near the photo' : 'Store'} · Enter picks</span>
		<button type="button" disabled={!q.trim() || loading || osmLoading} onclick={() => void askOsm()}>Search OpenStreetMap</button>
		<button type="button" onclick={oncancel}>Cancel</button>
	</div>
</div>

<style>
	.picker {
		background: #fff;
		border: 1px solid #c9c9c3;
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		max-height: 22rem;
		overflow: hidden;
	}
	input {
		font: inherit;
		font-size: 1rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0 0.6rem;
		border: 0;
		border-bottom: 1px solid #e6e6e1;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: auto;
		flex: 1;
	}
	li button {
		display: flex;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: 0;
		background: none;
		text-align: left;
		font: inherit;
		align-items: center;
	}
	li button.hi {
		background: #f1f6f1;
	}
	.name {
		flex: 1;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.new {
		font-weight: 400;
		color: #5c5f58;
	}
	.dist {
		color: #5c5f58;
		white-space: nowrap;
	}
	.none {
		padding: 0.5rem 0.6rem;
		color: #5c5f58;
	}
	.err {
		margin: 0;
		padding: 0.3rem 0.6rem;
		font-weight: 600;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0.6rem;
		border-top: 1px solid #e6e6e1;
		color: #5c5f58;
		font-size: 0.75rem;
	}
	.foot span {
		flex: 1;
	}
	.foot button {
		font-size: 0.85rem;
	}
</style>

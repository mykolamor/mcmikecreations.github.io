<script lang="ts">
	import { onDestroy } from 'svelte';
	import { api } from '../../api';

	export type PickItem = { ref: string; name: string | null; kind: string | null; lat: number; lon: number; inStore: boolean };

	// `slug` (+ `date`): results sorted by distance from that hike's route, OSM searched around its midpoint (not `center`).
	let {
		center,
		onpick,
		busy = false,
		slug = undefined,
		date = null,
		label = 'Add an object'
	}: { center: () => { lat: number; lon: number } | null; onpick: (item: PickItem) => void; busy?: boolean; slug?: string; date?: string | null; label?: string } = $props();
	const id = $props.id();

	let q = $state('');
	let store = $state<PickItem[]>([]);
	let osm = $state<PickItem[]>([]);
	let loading = $state<'store' | 'osm' | null>(null);
	let error = $state<string | null>(null);
	let osmError = $state<string | null>(null);
	let asked = $state<{ store: boolean; osm: boolean }>({ store: false, osm: false });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let gen = 0;

	function clear() {
		store = osm = [];
		asked = { store: false, osm: false };
		loading = null;
		error = osmError = null;
	}

	// The store (osm.json, substring of any name) is searched while typing; OpenStreetMap (Overpass) only on its button.
	async function search(source: 'store' | 'osm') {
		clearTimeout(timer);
		const text = q.trim();
		const mine = ++gen;
		if (!text) return clear();
		loading = source;
		const params = new URLSearchParams({ q: text, source });
		const c = center();
		if (c) (params.set('lat', String(c.lat)), params.set('lon', String(c.lon)));
		if (slug) (params.set('slug', slug), date && params.set('date', date));
		try {
			const r = await api<{ store: PickItem[]; osm: PickItem[]; osm_error?: string }>('GET', `/api/osm/search?${params}`);
			if (mine !== gen) return;
			if (source === 'store') store = r.store;
			else {
				// A pasted id already in the store comes back as a store result.
				osm = r.osm;
				if (r.store.length) store = r.store;
				osmError = r.osm_error ?? null;
			}
			error = null;
		} catch (e) {
			if (mine !== gen) return;
			if (source === 'store') store = [];
			else osm = [];
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (mine === gen) (loading = null, (asked = { ...asked, [source]: true }));
		}
	}

	function typed() {
		clearTimeout(timer);
		gen++; // drop answers for the old text
		osm = [];
		osmError = error = null;
		asked = { store: false, osm: false };
		loading = null;
		timer = setTimeout(() => void search('store'), 300);
	}
	onDestroy(() => (clearTimeout(timer), gen++));

	function pick(item: PickItem) {
		onpick(item);
		q = '';
		clear();
	}
</script>

<div class="picker">
	<label for="{id}-q">{label}</label>
	<input
		id="{id}-q"
		type="search"
		autocomplete="off"
		placeholder="Name, or paste an openstreetmap.org link / node/123"
		bind:value={q}
		oninput={typed}
		onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), void search('store'))}
		disabled={busy}
	/>
	<div class="buttons">
		<button type="button" disabled={busy || !q.trim() || loading !== null} onclick={() => void search('store')}>Search store</button>
		<button type="button" disabled={busy || !q.trim() || loading !== null} onclick={() => void search('osm')}>Search OpenStreetMap</button>
	</div>
	{#if loading === 'store'}<p class="msg">Searching the store...</p>{/if}
	{#if loading === 'osm'}<p class="msg">Searching OpenStreetMap (can take a minute when Overpass is busy)...</p>{/if}
	{#if error}<p class="msg err" role="alert">{error}</p>{/if}
	{#if store.length}
		<h4>In the store</h4>
		<ul>
			{#each store as item (item.ref)}
				<li><button type="button" onclick={() => pick(item)}><strong>{item.name ?? item.ref}</strong><small>{item.ref}{item.kind ? ` - ${item.kind}` : ''}</small></button></li>
			{/each}
		</ul>
	{/if}
	{#if osm.length}
		<h4>OpenStreetMap{slug ? ' (nearest the route first)' : center() ? ' (near the map centre)' : ''}</h4>
		<ul>
			{#each osm as item (item.ref)}
				<li><button type="button" onclick={() => pick(item)}><strong>{item.name ?? item.ref}</strong><small>{item.ref}{item.kind ? ` - ${item.kind}` : ''}{item.inStore ? ' - already in the store' : ' - not in the store yet'}</small></button></li>
			{/each}
		</ul>
	{/if}
	{#if osmError}<p class="msg err">OpenStreetMap search failed: {osmError}</p>{/if}
	{#if asked.store && !loading && !error && !store.length && !osm.length}<p class="msg">Not in the store. Try Search OpenStreetMap.</p>{/if}
	{#if asked.osm && !loading && !error && !osmError && !osm.length && !store.length}<p class="msg">Nothing found on OpenStreetMap.</p>{/if}
</div>

<style>
	.picker {
		margin-top: 0.5rem;
	}
	label {
		display: block;
		font-size: 0.85rem;
		color: #555;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0 0.5rem;
		font-size: 1rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.buttons button {
		flex: 1 1 10rem;
		min-height: 2.75rem;
	}
	h4 {
		margin: 0.5rem 0 0.2rem;
		font-size: 0.85rem;
		color: #555;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		min-height: 2.75rem;
		text-align: left;
		padding: 0.25rem 0.5rem;
		margin-bottom: 0.2rem;
	}
	small {
		color: #666;
		overflow-wrap: anywhere;
	}
	.msg {
		margin: 0.25rem 0;
		font-size: 0.9rem;
	}
	.err {
		color: #b00020;
	}
</style>

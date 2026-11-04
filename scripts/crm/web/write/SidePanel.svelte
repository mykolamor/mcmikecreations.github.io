<script lang="ts">
	import L from 'leaflet';
	import 'leaflet/dist/leaflet.css';
	import { onMount, tick } from 'svelte';
	import type { PostPhoto } from '../photos/types';
	import InsertPhoto from './InsertPhoto.svelte';
	import type { MapFocus } from './mentions';

	// Beside the editor (on a phone, a sheet above the tab bar that folds away): a mini map on the photo or place mention at
	// the cursor, and the photos the text doesn't show yet.
	let {
		focus,
		origin,
		photos,
		loading,
		error,
		onpick
	}: {
		/** The photo or mention at the cursor; the map stays where it was while the cursor is on neither. */
		focus: MapFocus | null;
		/** Where the map starts before the cursor has been on anything. */
		origin: { lat: number; lon: number } | null;
		photos: PostPhoto[];
		loading: boolean;
		error: string | null;
		onpick: (p: PostPhoto) => void;
	} = $props();

	let mapEl = $state<HTMLDivElement | null>(null);
	let map: L.Map | null = null;
	let marker: L.CircleMarker | null = null;
	// Folded on a phone at first, so the editor keeps the screen; always open beside the editor.
	let open = $state(typeof matchMedia === 'function' ? !matchMedia('(max-width: 600px)').matches : true);

	onMount(() => {
		if (!mapEl) return;
		const m = L.map(mapEl, { zoomControl: true, attributionControl: true });
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
		m.setView(origin ? [origin.lat, origin.lon] : [47.5, 11.5], origin ? 12 : 8);
		map = m;
		show(focus);
		return () => {
			map = null;
			marker = null;
			m.remove();
		};
	});

	function show(f: MapFocus | null) {
		if (!map || !f) return;
		marker?.remove();
		marker = L.circleMarker([f.lat, f.lon], { radius: 8, color: '#c25e00', weight: 3, fillOpacity: 0.4 }).bindTooltip(f.label).addTo(map);
		map.setView([f.lat, f.lon], Math.max(map.getZoom(), 14));
	}

	$effect(() => show(focus));

	// The origin arrives after the panel: until the cursor has been on something, the map starts there.
	$effect(() => {
		if (origin && map && !marker) map.setView([origin.lat, origin.lon], 12);
	});

	async function toggle() {
		open = !open;
		await tick();
		map?.invalidateSize();
	}
</script>

<aside class="side" class:open aria-label="Map and photos">
	<button type="button" class="toggle" aria-expanded={open} onclick={toggle}>{open ? 'Hide map and photos' : 'Map and photos'}</button>
	<div class="content">
		<div class="map" bind:this={mapEl} role="img" aria-label={focus ? `Map: ${focus.label}` : 'Map'}></div>
		<p class="hint">{focus ? focus.label : 'Put the cursor on a photo or a place to see it here'}</p>
		<InsertPhoto {photos} {loading} {error} {onpick} />
	</div>
</aside>

<style>
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.map {
		height: 14rem;
		border: 1px solid #888;
		border-radius: 4px;
		/* Leaflet's panes (z-index 400) stay inside the map, under the place suggestions. */
		isolation: isolate;
	}
	.hint {
		margin: 0;
		color: #444;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.toggle {
		display: none;
		min-height: 2.75rem;
	}
	/* A phone: a sheet fixed above the tab bar, its toggle always in view; open, it holds the map and photos. */
	@media (max-width: 600px) {
		.side {
			position: fixed;
			inset: auto 0 calc(var(--tab-bar-height) + 1px + env(safe-area-inset-bottom)) 0;
			z-index: 21;
			gap: 0;
			background: #fff;
			border-top: 1px solid #888;
			box-shadow: 0 -2px 6px rgb(0 0 0 / 0.12);
		}
		.toggle {
			display: block;
			width: 100%;
			border: none;
			border-radius: 0;
		}
		.content {
			max-height: 55dvh;
			overflow-y: auto;
			padding: 0.4rem 0.75rem 0.6rem;
		}
		.side:not(.open) .content {
			display: none;
		}
		.map {
			height: 12rem;
			flex: none;
		}
	}
</style>

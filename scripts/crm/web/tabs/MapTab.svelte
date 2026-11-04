<script lang="ts">
	import L from 'leaflet';
	import { onMount } from 'svelte';
	import { initElevationChart } from '$lib/hikes/map-elevation';
	import type { createDocSession } from '../doc-session';
	import type { MapPayload } from '../../server/map-data';
	import CheckpointsPanel from '../components/map/CheckpointsPanel.svelte';
	import MapViewPanel from '../components/map/MapViewPanel.svelte';
	import NodeDetail from '../components/map/NodeDetail.svelte';
	import NodesPanel from '../components/map/NodesPanel.svelte';
	import { emitMapSelect, onMapSelect } from '../map/layers/registry';
	import { createMapView, type MapView } from '../map/map-view';

	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	let mapEl: HTMLDivElement;
	let chartEl: HTMLDivElement;
	let view = $state.raw<MapView | null>(null);
	let data = $state.raw<MapPayload | null>(null);
	// Bumped on every doc / queue change so the side panel re-reads the session (which is not reactive by itself).
	let rev = $state(0);
	let selectedRef = $state<string | null>(null);
	let ring: L.CircleMarker | null = null;
	let chart: ReturnType<typeof initElevationChart> | null = null;
	let error = $state<string | null>(null);
	let loaded = '';

	// Everything the payload depends on: the doc version plus the route/GPX files an upload changed without touching the
	// doc, and `deps` (those files and the OSM store changed outside the CRM).
	const keyOf = () => {
		const f = session.doc?.files as { gpx?: unknown; geojson?: unknown; bailouts?: unknown } | null | undefined;
		return `${session.doc?.version ?? ''}|${session.doc?.deps ?? ''}|${JSON.stringify([f?.gpx, f?.geojson, f?.bailouts])}`;
	};

	function drawChart() {
		chartEl.replaceChildren();
		chart = null;
		const geo = view?.routeGeojson();
		if (!geo) return;
		chart = initElevationChart(
			chartEl,
			geo,
			(lat, lon) => view?.setMarker({ lat, lon }),
			() => view?.setMarker(null)
		);
	}

	/** Rings a point on the map (a selected checkpoint or node) and pans to it when it is out of view; null clears. */
	function focusPoint(p: { lat: number; lon: number } | null) {
		ring?.remove();
		ring = null;
		if (!p || !view) return;
		ring = L.circleMarker([p.lat, p.lon], { radius: 14, color: '#e65100', weight: 3, fill: false, interactive: false }).addTo(view.map);
		if (!view.map.getBounds().contains([p.lat, p.lon])) view.map.panTo([p.lat, p.lon]);
	}

	function selectRef(ref: string | null) {
		selectedRef = ref;
		const n = ref ? data?.nodes.find((x) => x.ref === ref) : null;
		focusPoint(n ? { lat: n.lat, lon: n.lon } : null);
	}

	/** After a store write (local tags, refresh): rebuild the map layers so names and positions follow. */
	async function reloadMap() {
		if (!view) return;
		try {
			data = await view.refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function sync() {
		if (!view) return;
		const key = keyOf();
		if (key === loaded || !session.doc) return;
		loaded = key;
		try {
			data = await view.refresh();
			error = null;
			drawChart();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(() => {
		let off: (() => void) | undefined;
		let dead = false;
		createMapView(mapEl, session)
			.then((v) => {
				if (dead) return v.destroy();
				view = v;
				data = v.data();
				loaded = keyOf();
				v.onRouteHover(
					(lat, lon) => chart?.setIndicator(lat, lon),
					() => chart?.hideIndicator()
				);
				drawChart();
				const offSession = session.subscribe(() => (rev++, void sync()));
				const offSelect = onMapSelect(selectRef);
				off = () => (offSession(), offSelect());
				void sync();
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)));
		return () => {
			dead = true;
			off?.();
			ring?.remove();
			view?.destroy();
		};
	});
</script>

<div class="map-tab">
	<div class="main">
		{#if error}<p class="err" role="alert">{error}</p>{/if}
		<div class="map" bind:this={mapEl} aria-label="Map"></div>
		<div class="elevation" bind:this={chartEl} aria-label="Elevation profile"></div>
	</div>
	<aside class="side" data-slot="map-side" aria-label="Map details">
		{#if view}
			<MapViewPanel {session} {view} {rev} />
			<CheckpointsPanel {session} {view} {data} {rev} onfocuspoint={focusPoint} />
			<NodesPanel {session} {view} {data} {rev} {selectedRef} onselect={emitMapSelect} />
			{#if selectedRef}
				<NodeDetail ref={selectedRef} {view} onclose={() => emitMapSelect(null)} onchanged={reloadMap} />
			{/if}
		{/if}
	</aside>
</div>

<style>
	.map-tab {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: 1rem;
		align-items: start;
	}
	.main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.map {
		height: calc(100vh - 16rem);
		min-height: 22rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	.elevation {
		min-height: 0;
	}
	.side:empty {
		display: none;
	}
	.side {
		min-width: 0;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
	}
	.side > :global(section) {
		margin-bottom: 1rem;
	}
	.err {
		margin: 0;
		color: #b00020;
	}
	@media (max-width: 719px) {
		.map-tab {
			grid-template-columns: minmax(0, 1fr);
		}
		.map {
			height: 60vh;
			min-height: 16rem;
		}
		/* the side panel is a sheet below the map */
		.side {
			border-top: 1px solid #ccc;
			border-radius: 12px 12px 0 0;
			box-shadow: 0 -2px 8px rgb(0 0 0 / 0.12);
			padding: 0.75rem;
			min-height: 6rem;
			max-height: none;
			overflow-y: visible;
		}
		/* Leaflet's own controls up to a 44 px touch target; the open layer list scrolls inside the map */
		.map :global(.leaflet-bar a),
		.map :global(.leaflet-touch .leaflet-bar a) {
			width: 44px;
			height: 44px;
			line-height: 44px;
		}
		.map :global(.leaflet-control-layers-toggle) {
			width: 44px;
			height: 44px;
		}
		.map :global(.leaflet-control-layers-expanded) {
			max-width: calc(100vw - 7.5rem);
			max-height: calc(100% - 20px);
			overflow-y: auto;
		}
		.map :global(.leaflet-control-layers-list label) {
			display: block;
			padding: 0.5rem 0;
		}
		.map :global(.leaflet-control-layers-selector) {
			width: 1.25rem;
			height: 1.25rem;
			vertical-align: middle;
		}
	}
</style>

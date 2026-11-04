<script lang="ts">
	import L from 'leaflet';
	import 'leaflet/dist/leaflet.css';
	import { onMount, tick, untrack } from 'svelte';
	import { buildFactsOverlay, chartPins, routeSlice, type FactsOverlay } from '$lib/hikes/facts-overlay';
	import { initElevationChart } from '$lib/hikes/map-elevation';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import type { DocFacts } from '../../server/facts-read';
	import { baseLayers } from '../map/layers/base';
	import { pickBase } from '../map/layers/base-pick';
	import { readPref } from '../map/storage';
	import { localFacts, shownOps, type Scope } from './facts-state';
	import { factsLayer } from './facts-layer';
	import { chartMetrics, highlightBand, latestOnly, previewDraft, previewIndex, routeGeojson } from './preview';

	// The facts as the post page draws them, with the unsaved edits: the profile with its bands and pins, and a small map
	// of the route with the facts' marks. Beside the form; on a phone, a sheet above the tab bar that folds away.
	// `selected`: the route list's selected entry (its index in the scope's merged list), highlighted on both.
	// `libraryVersion`: the shared records' version, read again when it changes; `onfacts` gets each good reading.
	let {
		session,
		scope,
		selected,
		libraryVersion = null,
		onfacts
	}: { session: ReturnType<typeof createDocSession>; scope: Scope; selected: number | null; libraryVersion?: string | null; onfacts?: (r: DocFacts) => void } = $props();

	const DEBOUNCE_MS = 300;

	let chartEl: HTMLDivElement;
	let mapEl: HTMLDivElement;
	let map: L.Map | null = null;
	let route: L.Polyline | null = null;
	let marks: L.LayerGroup | null = null;
	let highlight: L.Polyline | null = null;
	let hover: L.CircleMarker | null = null;

	// The last good reading (a half-typed value keeps it) and the site's error, if the latest reading has one.
	let good = $state.raw<DocFacts | null>(null);
	let error = $state<string | null>(null);
	let overlay = $state.raw<FactsOverlay | null>(null);
	// The selected entry's index in the list the preview draws, re-read with the session.
	let index = $state<number | null>(null);
	let rev = $state(0);
	// Folded on a phone at first, so the form keeps the screen; always open beside the form.
	let open = $state(typeof matchMedia === 'function' ? !matchMedia('(max-width: 719px)').matches : true);

	const band = $derived(good ? highlightBand(good.facts, index, good.coords, good.distanceFactor) : null);

	let sent = '';
	const show = latestOnly<DocFacts>(
		(r) => {
			error = r.error;
			if (r.error) return;
			good = r;
			onfacts?.(r);
			overlay = buildFactsOverlay(r.facts, 'en', r.coords, r.distanceFactor, r.nodeRefs);
		},
		(e) => {
			error = e instanceof Error ? e.message : String(e);
			// Not answered: the next session change sends it again.
			sent = '';
		}
	);

	function readIndex() {
		const ops = shownOps(session.queue);
		const legs = (s: Scope) => (localFacts(session.doc, ops, s) as Record<string, unknown> | undefined)?.legs;
		index = previewIndex(scope, selected, legs('hike'), session.date ? legs('post') : undefined, session.date != null);
	}

	// Each change of the draft (or of the doc's route files) posts it again, debounced.
	let timer: ReturnType<typeof setTimeout> | null = null;
	function sync() {
		rev++;
		if (!session.doc) return;
		const ref = session.date ? ({ kind: 'post', slug: session.slug, date: session.date } as const) : ({ kind: 'hike', slug: session.slug } as const);
		const draft = previewDraft(session.doc, shownOps(session.queue), ref);
		const key = JSON.stringify([draft, session.doc.version, session.doc.deps, session.doc.files, libraryVersion]);
		if (key === sent) return;
		sent = key;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			const q = new URLSearchParams(session.date ? { slug: session.slug, date: session.date } : { slug: session.slug });
			void show(api<DocFacts>('POST', `/api/facts/preview?${q}`, { draft }));
		}, DEBOUNCE_MS);
	}

	// A shared record saved: the facts that take it read differently.
	$effect(() => {
		void libraryVersion;
		untrack(sync);
	});

	$effect(() => {
		void rev;
		void scope;
		void selected;
		readIndex();
	});

	onMount(() => {
		const m = L.map(mapEl, { zoomControl: true });
		m.setView([47.5, 11.5], 8);
		map = m;
		let gone = false;
		void api<{ tracestrackKey: string | null }>('GET', '/api/map/config')
			.catch(() => ({ tracestrackKey: null }))
			.then((config) => {
				if (gone) return;
				const bases = baseLayers(config.tracestrackKey);
				// The Map tab's remembered base layer; the others one tap away.
				pickBase(bases, readPref('crm.map.base')).layer!.addTo(m);
				L.control.layers(Object.fromEntries(bases.filter((b) => b.layer).map((b) => [b.label, b.layer!]))).addTo(m);
			});
		// From the phone's sheet to beside the form (or back): the map's size changed while it may have been hidden.
		const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 719px)') : null;
		const relayout = () => {
			m.invalidateSize();
			// Beside the form the preview always shows, even when the sheet was folded.
			if (!phone?.matches) open = true;
			if (open) fitShown();
		};
		phone?.addEventListener('change', relayout);
		sync();
		const off = session.subscribe(sync);
		return () => {
			gone = true;
			phone?.removeEventListener('change', relayout);
			off();
			if (timer) clearTimeout(timer);
			map = null;
			m.remove();
		};
	});

	// A new reading: the route (fitted when it changed, once the map shows) and the facts' marks.
	let fittedTo = '';
	$effect(() => {
		const r = good;
		const o = overlay;
		if (!map || !r || !o) return;
		route?.remove();
		marks?.remove();
		route = L.polyline(r.coords.map((c) => [c[1], c[0]] as [number, number]), { color: '#1565c0', weight: 4, opacity: 0.9, interactive: false }).addTo(map);
		marks = factsLayer(o).addTo(map);
		const coords = JSON.stringify(r.coords);
		if (open && r.coords.length && coords !== fittedTo) {
			fittedTo = coords;
			map.fitBounds(route.getBounds(), { padding: [16, 16] });
		}
		highlight?.bringToBack();
	});

	// The profile, re-drawn with each reading and each selection (its band is one of the chart's).
	$effect(() => {
		const r = good;
		const o = overlay;
		const b = band;
		if (!chartEl || !r || !o) return;
		// The old chart goes without its leave: its hover marker with it.
		hover?.remove();
		hover = null;
		chartEl.replaceChildren();
		if (!r.coords.length) return;
		initElevationChart(
			chartEl,
			routeGeojson(r.coords),
			(lat, lon) => {
				if (!map) return;
				hover?.remove();
				hover = L.circleMarker([lat, lon], { radius: 6, color: '#e65100', weight: 3, fillOpacity: 0.6, interactive: false }).addTo(map);
			},
			() => {
				hover?.remove();
				hover = null;
			},
			chartMetrics(r.coords, r.distanceFactor),
			[],
			undefined,
			{ bands: b ? [...o.bands, b] : o.bands, pins: chartPins(o.pins) }
		);
	});

	// The selected stretch on the map: an orange line under the route, the map fitted to it when it changed, and back to
	// the route when the selection clears.
	let shownSpan = '';
	$effect(() => {
		const r = good;
		const b = band;
		highlight?.remove();
		highlight = null;
		if (!b && shownSpan) {
			shownSpan = '';
			if (open && route) map?.fitBounds(route.getBounds(), { padding: [16, 16] });
		}
		if (!map || !r || !b) return;
		const slice = routeSlice(r.coords, r.distanceFactor, b.from, b.to);
		if (slice.length < 2) return;
		highlight = L.polyline(slice, { color: '#e65100', weight: 8, opacity: 0.9, interactive: false }).addTo(map);
		highlight.bringToBack();
		const span = `${b.from}|${b.to}`;
		if (open && span !== shownSpan) {
			shownSpan = span;
			map.fitBounds(highlight.getBounds(), { padding: [24, 24] });
		}
	});

	/** Fits the map to the selected stretch, else the route. */
	function fitShown() {
		const shown = highlight ?? route;
		if (map && shown) map.fitBounds(shown.getBounds(), { padding: [16, 16] });
	}

	async function toggle() {
		open = !open;
		await tick();
		map?.invalidateSize();
		if (open) fitShown();
	}
</script>

<aside class="preview" class:open aria-label="Preview" data-bottom-overlay>
	<button type="button" class="toggle" aria-expanded={open} onclick={toggle}>{open ? 'Hide preview' : 'Preview'}</button>
	<div class="content">
		{#if error}
			<p class="problem" role="alert"><strong>Error:</strong> {error}</p>
		{/if}
		{#if good && !good.coords.length}
			<p class="note">No route file: nothing to draw the facts on.</p>
		{/if}
		<div class="chart" bind:this={chartEl} aria-label="Elevation profile"></div>
		<div class="map" bind:this={mapEl} role="img" aria-label="Map of the route and its facts"></div>
	</div>
</aside>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
		position: sticky;
		/* Below App's sticky header. */
		top: calc(var(--header-height, 0px) + 0.5rem);
	}
	.content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.problem {
		margin: 0;
		border: 1px solid #b00020;
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		color: #b00020;
		overflow-wrap: anywhere;
	}
	.note {
		margin: 0;
		color: #555;
		font-size: 0.9rem;
	}
	.chart {
		min-height: 6rem;
	}
	.map {
		height: 18rem;
		border: 1px solid #888;
		border-radius: 4px;
		/* Leaflet's panes (z-index 400) stay inside the map. */
		isolation: isolate;
	}
	.toggle {
		display: none;
		font: inherit;
		min-height: 2.75rem;
	}
	/* A phone: a sheet fixed above the tab bar, its toggle always in view; open, it holds the profile and the map. */
	@media (max-width: 719px) {
		.preview {
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
			max-height: 60dvh;
			overflow-y: auto;
			padding: 0.4rem 0.75rem 0.6rem;
		}
		.preview:not(.open) .content {
			display: none;
		}
		.map {
			height: 12rem;
			flex: none;
		}
	}
</style>

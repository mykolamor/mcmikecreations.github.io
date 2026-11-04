<script lang="ts">
	import type { AuthoredPlace } from '$lib/hikes/facts-library.server';
	import { api, upload } from '../api';
	import OsmPicker, { type PickItem } from '../components/map/OsmPicker.svelte';
	import { ensureInStore } from '../pins/pin-ops';
	import TextField from './TextField.svelte';
	import { REMOVE, type FactsCtx, type Path } from './facts-state';
	import { mergeText } from './form-model';
	import { bailoutFiles, isNamedSpot, namedLabel, placeValue, pointName, spotName, spotNameOf, spotPlace, tapPick, withPointName, type PlacePick } from './place-value';
	import { routeMap } from './route-map';
	import { rememberName, storeName } from './store-names.svelte';

	// A place, spot or bailout GPX of the facts form. A place is picked from the store or OSM (nearest the route first),
	// tapped on the route's map, or given as a km; a spot may also be just a name; a GPX is one of the doc's bailout files.
	let {
		spec,
		path,
		label,
		value,
		ctx,
		onset
	}: { spec: { t: 'place' | 'spot' | 'gpx' }; path: Path; label: string; value: unknown; ctx: FactsCtx; onset: (v: unknown, debounce: boolean) => void } = $props();

	type Tab = 'search' | 'map' | 'km' | 'name';
	let open = $state(false);
	let tab = $state<Tab>('search');
	let busy = $state(false);
	let error = $state<string | null>(null);
	const doc = $derived(ctx.doc());

	const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
	// The place itself: a named spot's `at`, else the value.
	const where = $derived(spec.t === 'spot' && isNamedSpot(value) ? value.at : value);

	function write(place: AuthoredPlace) {
		onset(spec.t === 'spot' ? spotPlace(value, place) : place, false);
		open = false;
		error = null;
	}

	async function run(fn: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// An element OSM has but the store doesn't is added to the store first (with its height), then written as `{ref}`.
	function pickElement(item: PickItem) {
		void run(async () => {
			await ensureInStore(item);
			rememberName(item.ref, item.name);
			write(placeValue({ kind: 'element', ref: item.ref }));
		});
	}

	// The map: a tap marks a point, named before it is written.
	let tapped = $state<{ lat: number; lon: number } | null>(null);
	let tapName = $state('');
	const startAt = $derived.by(() => {
		const w = obj(where);
		return typeof w.lat === 'number' && typeof w.lon === 'number' ? { lat: w.lat, lon: w.lon } : null;
	});
	function useTap() {
		const t = tapped;
		if (!t || !tapName.trim()) return;
		void run(async () => write(placeValue(await tapPick(t.lat, t.lon, tapName, api))));
	}

	let km = $state('');
	function useKm() {
		const n = Number(km);
		if (String(km).trim() === '' || !Number.isFinite(n) || n < 0) {
			error = 'A distance in km, 0 or more';
			return;
		}
		write(placeValue({ kind: 'km', km: n } satisfies PlacePick));
	}

	// "Just a name": the spot's name (a plain name string included), its place (if any) kept.
	const spotNameValue = $derived(spotNameOf(value));
	function editName(edit: Record<string, string>, debounce: boolean) {
		const r = mergeText(spotNameValue, edit);
		if (!('value' in r)) return;
		onset(spotName(value, r.value) ?? REMOVE, debounce);
	}

	// The name of a point that is the value (a named spot's `at` shows the spot's name instead): a text, English and the
	// session language; cleared, the point stays unnamed. Written as the whole value, the name merged by the text rules.
	const point = $derived(pointName(value));
	const pointPath = $derived<Path>([...path, 'name']);
	function editPointName(edit: Record<string, string>, debounce: boolean) {
		const r = mergeText(point, edit);
		if ('value' in r) onset(withPointName(value, r.value), debounce);
	}

	function toggle() {
		open = !open;
		error = null;
		if (open) {
			tapped = null;
			tapName = '';
			km = typeof obj(where).km === 'number' ? String(obj(where).km) : '';
		}
	}

	// Files uploaded here this session: listed until the doc's files state names them (once a bailout uses one and is saved).
	let uploaded = $state<string[]>([]);
	const files = $derived([...new Set([...bailoutFiles(doc?.files), ...uploaded])]);
	const fileName = (route: string) => route.split('/').pop() ?? route;

	// A new bailout GPX: written to the bailouts folder under a free name (from the file's), then picked here.
	function uploadGpx(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		const slug = doc?.slug;
		const date = doc?.date;
		if (!file || !slug) return;
		void run(async () => {
			const params = new URLSearchParams({ slug, ...(date ? { date } : {}) });
			const r = await upload<{ route: string }>(`/api/files/bailout/new?${params}`, file);
			uploaded = [...uploaded, r.route];
			onset(r.route, false);
		});
	}
</script>

{#if spec.t === 'gpx'}
	<div class="gpx">
	<label class="field">
		<span class="name">{label}</span>
		<select value={typeof value === 'string' ? value : ''} onchange={(e) => onset((e.currentTarget as HTMLSelectElement).value || REMOVE, false)}>
			<option value="">—</option>
			{#each files as f (f)}
				<option value={f}>{fileName(f)}</option>
			{/each}
			<!-- A route the files state doesn't list (missing on disk, or typed by hand) still shows. -->
			{#if typeof value === 'string' && value && !files.includes(value)}
				<option {value}>{fileName(value)} (not found)</option>
			{/if}
		</select>
	</label>
	<label class="upload">
		<input type="file" accept=".gpx,application/gpx+xml,application/octet-stream,text/xml,*/*" disabled={busy || !doc?.slug} onchange={uploadGpx} />
		<span class="button" aria-disabled={busy || !doc?.slug}>{busy ? 'Uploading…' : 'Upload new GPX'}</span>
	</label>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	</div>
{:else}
	<div class="field">
		<span class="name">{label}</span>
		<div class="current">
			<span>{namedLabel(value, storeName) || '—'}</span>
			<button type="button" aria-expanded={open} onclick={toggle}>{open ? 'Close' : value == null ? 'Pick' : 'Change'}</button>
			{#if value != null}
				<button type="button" aria-label="Clear {label || 'place'}" onclick={() => onset(REMOVE, false)}>✕</button>
			{/if}
		</div>
		{#if point !== null}
			<TextField label="Name of the point" value={point} stated={() => ctx.stated(pointPath)} lang={ctx.lang} onedit={editPointName} draft={ctx.draft?.has(pointPath) ?? false} ontouch={() => ctx.draft?.clear(pointPath)} />
		{/if}
		{#if open}
			<div class="picker">
				<div class="tabs" role="group" aria-label="Pick the place by">
					<button type="button" aria-pressed={tab === 'search'} onclick={() => (tab = 'search')}>Search</button>
					<button type="button" aria-pressed={tab === 'map'} onclick={() => (tab = 'map')}>On the map</button>
					<button type="button" aria-pressed={tab === 'km'} onclick={() => (tab = 'km')}>At km</button>
					{#if spec.t === 'spot'}
						<button type="button" aria-pressed={tab === 'name'} onclick={() => (tab = 'name')}>Just a name</button>
					{/if}
				</div>
				{#if tab === 'search'}
					<OsmPicker center={() => null} slug={doc?.slug} date={doc?.date ?? null} label="The store and OpenStreetMap" {busy} onpick={pickElement} />
				{:else if tab === 'map'}
					{#if doc?.slug}
						<div class="map" use:routeMap={{ slug: doc.slug, date: doc.date ?? null, at: startAt, ontap: (p) => (tapped = p) }} role="application" aria-label="Map of the route: tap the place"></div>
					{/if}
					<p class="hint">{tapped ? `${tapped.lat.toFixed(5)}, ${tapped.lon.toFixed(5)}` : 'Tap the place on the map'}</p>
					<div class="row">
						<input placeholder="Name it" aria-label="Name of the point" bind:value={tapName} disabled={!tapped || busy} />
						<button type="button" disabled={!tapped || !tapName.trim() || busy} onclick={useTap}>Use this point</button>
					</div>
				{:else if tab === 'km'}
					<div class="row">
						<input type="number" inputmode="decimal" min="0" step="any" placeholder="km" aria-label="Distance along the route, km" bind:value={km} />
						<button type="button" onclick={useKm}>Use this km</button>
					</div>
				{:else}
					<TextField label="Name" value={spotNameValue} lang={ctx.lang} onedit={editName} draft={ctx.draft?.has(pointPath) ?? false} ontouch={() => ctx.draft?.clear(pointPath)} />
					{#if isNamedSpot(value) && value.at != null}
						<button type="button" onclick={() => onset({ name: value.name }, false)}>No place, the name only</button>
					{/if}
				{/if}
				{#if busy}<p class="hint">Adding…</p>{/if}
				{#if error}<p class="err" role="alert">{error}</p>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.gpx {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.upload {
		position: relative;
		align-self: flex-start;
	}
	.upload input {
		position: absolute;
		inset: 0;
		opacity: 0;
		width: 100%;
		min-height: 0;
		padding: 0;
		cursor: pointer;
	}
	.upload input:disabled {
		cursor: default;
	}
	.upload .button {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.6rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #f4f4f4;
		font-size: 0.95rem;
	}
	.upload .button[aria-disabled='true'] {
		opacity: 0.6;
	}
	.upload:focus-within .button {
		outline: 2px solid #1b5e20;
		outline-offset: 2px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
		min-width: 0;
	}
	.name:empty {
		display: none;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.current span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	input,
	select {
		font: inherit;
		font-size: 0.95rem;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		min-width: 0;
		background: #fff;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0.5rem;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tabs button {
		border: 1px solid #888;
		border-radius: 4px;
		background: #fff;
	}
	.tabs button[aria-pressed='true'] {
		background: #1b5e20;
		border-color: #1b5e20;
		color: #fff;
	}
	.map {
		height: 16rem;
		border: 1px solid #bbb;
		border-radius: 4px;
	}
	.row {
		display: flex;
		gap: 0.4rem;
	}
	.row input {
		flex: 1;
	}
	.hint {
		margin: 0;
		color: #555;
	}
	.err {
		margin: 0;
		color: #b00020;
	}
</style>

<script lang="ts">
	import { groundSizeKm } from '../../../shared/tile-square';
	import type { MapView } from '../../map/map-view';
	import { currentValue, scopeOf, setField, type EditSession } from '../../map/tools/scope';
	import { settle } from '../../map/tools/toast';
	import { parseLatLon, parseSize } from '../../map/view-ops';
	import ScopeSwitch from './ScopeSwitch.svelte';

	let { session, view, rev }: { session: EditSession & { date: string | null }; view: MapView | null; rev: number } = $props();

	type Origin = { lat: number; lon: number };
	const origin = $derived.by(() => {
		void rev;
		return currentValue<Origin>(session, 'map.origin', scopeOf(session, 'map.origin')) ?? null;
	});
	const height = $derived.by(() => {
		void rev;
		return currentValue<number>(session, 'map.height', scopeOf(session, 'map.height')) ?? null;
	});
	const originText = $derived(origin ? `${origin.lat}, ${origin.lon}` : '');
	const km = $derived(origin && height ? groundSizeKm(origin.lat, height) : null);

	let originDraft = $state<string | null>(null);
	let sizeDraft = $state<string | null>(null);
	let err = $state<string | null>(null);

	function save(field: string, value: unknown, done: string) {
		setField(session, field, value, scopeOf(session, field));
		if (view) void settle(view.map, session as any, done);
	}

	function commitOrigin() {
		const text = originDraft;
		originDraft = null;
		if (text === null || text.trim() === originText) return (err = null);
		const o = parseLatLon(text);
		if (!o) return (err = 'Origin: expected "lat, lon", for example 47.71877, 11.80515');
		err = null;
		save('map.origin', o, `Origin set to ${o.lat}, ${o.lon}`);
		view?.map.panTo([o.lat, o.lon]);
	}

	function commitSize() {
		const text = sizeDraft;
		sizeDraft = null;
		if (text === null || text.trim() === String(height ?? '')) return (err = null);
		const n = parseSize(text);
		if (n === null) return (err = 'Size: a whole number of px from 128 to 2048');
		err = null;
		save('map.height', n, `Size set to ${n} px`);
	}
</script>

<section aria-label="Map view">
	<h3>Map view</h3>
	{#if err}<p class="err" role="alert">{err}</p>{/if}

	<div class="field">
		<label for="origin-in">Origin (lat, lon)</label>
		<input
			id="origin-in"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			placeholder="47.71877, 11.80515"
			value={originDraft ?? originText}
			oninput={(e) => (originDraft = e.currentTarget.value)}
			onchange={commitOrigin}
			onblur={commitOrigin}
			onkeydown={(e) => e.key === 'Enter' && commitOrigin()}
		/>
		<ScopeSwitch {session} field="map.origin" {rev} onnote={(t) => (err = t)} />
	</div>

	<div class="field">
		<label for="size-in">Size (px)</label>
		<div class="size">
			<input
				id="size-in"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				placeholder="512"
				value={sizeDraft ?? (height ?? '')}
				oninput={(e) => (sizeDraft = e.currentTarget.value)}
				onchange={commitSize}
				onblur={commitSize}
				onkeydown={(e) => e.key === 'Enter' && commitSize()}
			/>
			{#if km !== null}<span class="km">&asymp; {km.toFixed(1)} km</span>{/if}
		</div>
		<small>Or drag the green corner of the square on the map.</small>
		<ScopeSwitch {session} field="map.height" {rev} onnote={(t) => (err = t)} />
	</div>
</section>

<style>
	h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-bottom: 0.75rem;
	}
	label {
		font-size: 0.85rem;
		color: #555;
	}
	input[type='text'] {
		min-height: 2.75rem;
		padding: 0 0.5rem;
		font-size: 1rem;
		box-sizing: border-box;
		width: 100%;
	}
	.size {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.size input {
		max-width: 8rem;
	}
	.km {
		color: #444;
	}
	small {
		color: #777;
	}
	.err {
		margin: 0 0 0.5rem;
		color: #b00020;
	}
</style>

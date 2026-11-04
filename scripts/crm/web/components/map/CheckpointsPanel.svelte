<script lang="ts">
	import { snap } from '../../../shared/snap';
	import type { MapPayload } from '../../../server/map-data';
	import type { MapView } from '../../map/map-view';
	import { moveTo, removeAt } from '../../map/list-ops';
	import { currentValue, scopeOf, setField, type EditSession } from '../../map/tools/scope';
	import { settle } from '../../map/tools/toast';
	import ReorderList from './ReorderList.svelte';
	import ScopeSwitch from './ScopeSwitch.svelte';

	let {
		session,
		view,
		data,
		rev,
		onfocuspoint
	}: { session: EditSession & { date: string | null }; view: MapView | null; data: MapPayload | null; rev: number; onfocuspoint: (p: { lat: number; lon: number } | null) => void } = $props();

	type Pt = [number, number];
	const list = $derived.by(() => {
		void rev;
		return currentValue<Pt[]>(session, 'map.checkpoints', scopeOf(session, 'map.checkpoints')) ?? [];
	});
	let selected = $state<number | null>(null);
	let note = $state<string | null>(null);

	/** The snapped node or other hike's checkpoint within 30 m, else the coordinates. */
	function nameOf([lon, lat]: Pt): string {
		const nodes = (data?.nodes ?? []).map((n) => ({ lat: n.lat, lon: n.lon, label: n.name ?? n.ref }));
		const others = (data?.others ?? []).flatMap((o) => o.checkpoints.map(([x, y]) => ({ lat: y, lon: x, label: `${o.name} checkpoint` })));
		const hit = snap({ lat, lon }, [...nodes, ...others], 30);
		return hit ? hit.label : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
	}

	function write(next: Pt[], done: string) {
		if (next === list) return;
		setField(session, 'map.checkpoints', next, scopeOf(session, 'map.checkpoints'));
		if (view) void settle(view.map, session as any, done);
	}
	function select(i: number) {
		selected = i;
		const p = list[i];
		if (p) onfocuspoint({ lat: p[1], lon: p[0] });
	}
	function move(from: number, to: number) {
		write(moveTo(list, from, to), 'Checkpoints reordered');
		if (selected === from) selected = to;
	}
	function remove(i: number) {
		write(removeAt(list, i), 'Checkpoint removed');
		selected = null;
		onfocuspoint(null);
	}
</script>

<section aria-label="Checkpoints">
	<h3>Checkpoints <span class="n">{list.length}</span></h3>
	{#if note}<p class="note">{note}</p>{/if}
	{#if list.length}
		<ReorderList items={list} keyOf={(p, i) => `${i}:${p[0]},${p[1]}`} {selected} label="Checkpoints" onselect={select} onmove={move} onremove={remove}>
			{#snippet row(p, i)}
				<strong>{i + 1}. {nameOf(p)}</strong>
			{/snippet}
		</ReorderList>
	{:else}
		<p class="empty">None yet. Use the checkpoint tool (C) on the map.</p>
	{/if}
	<ScopeSwitch {session} field="map.checkpoints" {rev} onnote={(t) => (note = t)} />
	<small class="hint">Removing the last checkpoint turns "This post only" off.</small>
</section>

<style>
	h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.n {
		color: #777;
		font-weight: normal;
	}
	.empty,
	.note {
		margin: 0.25rem 0;
		color: #666;
		font-size: 0.9rem;
	}
	.hint {
		display: block;
		color: #666;
	}
	strong {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
</style>

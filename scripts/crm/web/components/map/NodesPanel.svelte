<script lang="ts">
	import type { MapPayload } from '../../../server/map-data';
	import type { MapView } from '../../map/map-view';
	import { moveTo, removeAt } from '../../map/list-ops';
	import { addRef } from '../../map/osm-store';
	import { currentValue, setField, type EditSession } from '../../map/tools/scope';
	import { settle, toast } from '../../map/tools/toast';
	import OsmPicker, { type PickItem } from './OsmPicker.svelte';
	import ReorderList from './ReorderList.svelte';

	let {
		session,
		view,
		data,
		rev,
		selectedRef,
		onselect
	}: { session: EditSession; view: MapView | null; data: MapPayload | null; rev: number; selectedRef: string | null; onselect: (ref: string | null) => void } = $props();

	// Nodes are hike-wide only (a post cannot override them), so there is no "This post only" switch here.
	const list = $derived.by(() => {
		void rev;
		return currentValue<string[]>(session, 'map.nodes', 'hike') ?? [];
	});
	// Names for nodes added since the payload was loaded.
	let extra = $state<Record<string, { name: string | null; kind: string | null }>>({});
	let busy = $state(false);
	let note = $state<string | null>(null);
	let error = $state<string | null>(null);

	const meta = (ref: string) => data?.nodes.find((n) => n.ref === ref) ?? extra[ref] ?? null;
	const selected = $derived(selectedRef ? list.indexOf(selectedRef) : -1);

	function write(next: string[], done: string) {
		if (next === list) return;
		setField(session, 'map.nodes', next, 'hike');
		if (view) void settle(view.map, session as any, done);
	}
	function move(from: number, to: number) {
		write(moveTo(list, from, to), 'Nodes reordered');
	}
	function remove(i: number) {
		if (list[i] === selectedRef) onselect(null);
		write(removeAt(list, i), 'Node removed');
	}

	async function add(item: PickItem) {
		error = null;
		busy = true;
		try {
			if (!item.inStore) {
				note = 'Adding to the store...';
				note = (await addRef(item.ref)) ? 'Store changed, retried' : null;
			}
			extra[item.ref] = { name: item.name, kind: item.kind };
			if (!list.includes(item.ref)) write([...list, item.ref], `Node ${item.name ?? item.ref} added`);
			else if (view) toast(view.map, `${item.name ?? item.ref} is already a node`);
			onselect(item.ref);
		} catch (e) {
			note = null;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section aria-label="Nodes">
	<h3>Nodes <span class="n">{list.length}</span></h3>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	{#if note}<p class="note">{note}</p>{/if}
	{#if list.length}
		<ReorderList items={list} keyOf={(r) => r} selected={selected >= 0 ? selected : null} label="Nodes" onselect={(i) => onselect(list[i])} onmove={move} onremove={remove}>
			{#snippet row(ref)}
				<strong>{meta(ref)?.name ?? ref}</strong>
				<small>{meta(ref)?.kind ? `${meta(ref)?.kind} - ` : ''}{ref}</small>
			{/snippet}
		</ReorderList>
	{:else}
		<p class="note">No nodes yet.</p>
	{/if}
	<OsmPicker center={() => (view ? { lat: view.map.getCenter().lat, lon: view.map.getCenter().lng } : null)} onpick={add} {busy} />
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
	strong {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	small {
		color: #666;
		overflow-wrap: anywhere;
	}
	.note {
		margin: 0.25rem 0;
		color: #666;
		font-size: 0.9rem;
	}
	.err {
		margin: 0.25rem 0;
		color: #b00020;
	}
</style>

<script lang="ts">
	import type { MapView } from '../../map/map-view';
	import { localPatch, mergeRefreshed, redundantOffers, rowsOf, type Local, type Row } from '../../map/node-detail';
	import { loadEntry, refreshRef, saveLocal, StoreChangedError, type Entry, type RefreshResult } from '../../map/osm-store';
	import { toast } from '../../map/tools/toast';

	let { ref, view, onclose, onchanged }: { ref: string; view: MapView | null; onclose: () => void; onchanged: () => void } = $props();

	let entry = $state<Entry | null>(null);
	let version = $state('');
	let rows = $state<Row[]>([]);
	let visited = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);
	let refreshed = $state<RefreshResult | null>(null);
	let loadGen = 0;

	const say = (text: string, ms = 3000) => (view ? toast(view.map, text, ms) : void (note = text));

	function take(e: Entry, v: string) {
		entry = e;
		version = v;
		const r = rowsOf(e.local as Local | undefined);
		rows = r.rows;
		visited = r.visited;
	}

	async function load() {
		const mine = ++loadGen;
		loading = true;
		error = null;
		refreshed = null;
		try {
			const r = await loadEntry(ref);
			if (mine === loadGen) take(r.entry, r.version);
		} catch (e) {
			if (mine === loadGen) (entry = null, (error = e instanceof Error ? e.message : String(e)));
		} finally {
			if (mine === loadGen) loading = false;
		}
	}
	$effect(() => {
		void ref;
		void load();
		return () => loadGen++;
	});

	const patch = $derived(localPatch(entry?.local as Local | undefined, rows, visited));
	const tags = $derived(Object.entries(entry?.tags ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
	const title = $derived(entry?.tags?.name ?? entry?.local?.name ?? ref);

	async function save() {
		const body = patch;
		if (!body) return;
		busy = true;
		error = null;
		try {
			const r = await saveLocal(ref, body, version);
			take(r.entry, r.version);
			say('Local tags saved');
			onchanged();
		} catch (e) {
			if (e instanceof StoreChangedError) {
				note = 'osm.json changed elsewhere — reloaded';
				await load();
				onchanged();
			} else error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function refresh() {
		busy = true;
		error = null;
		note = null;
		try {
			const { result, retried } = await refreshRef(ref);
			// Rebuild from the refreshed local (keys added elsewhere appear), unsaved edits on top by key.
			const m = mergeRefreshed(entry?.local as Local | undefined, rows, visited, result.entry.local as Local | undefined);
			rows = m.rows;
			visited = m.visited;
			entry = result.entry;
			version = result.version;
			refreshed = result;
			if (retried) note = 'Store changed, retried';
			onchanged();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** Drops a now-redundant local key and saves (together with any other pending local edits). */
	async function drop(key: string) {
		if (key === 'visited') visited = '';
		else rows = rows.filter((r) => r.key.trim() !== key);
		refreshed = refreshed ? { ...refreshed, redundantLocal: refreshed.redundantLocal.filter((k) => k !== key) } : null;
		await save();
	}

	const offers = $derived(refreshed ? redundantOffers(refreshed, patch ?? (entry?.local as Local | undefined)) : []);
	const diffLines = $derived.by(() => {
		const d = refreshed?.diff;
		if (!d) return [] as string[];
		return [
			...Object.entries(d.added).map(([k, v]) => `+ ${k}=${v}`),
			...Object.entries(d.removed).map(([k, v]) => `- ${k}=${v}`),
			...Object.entries(d.changed).map(([k, c]) => `~ ${k}: ${c.from} -> ${c.to}`)
		];
	});
</script>

<section aria-label="Node details" class="detail">
	<header>
		<h3>{title}</h3>
		<button type="button" class="close" aria-label="Close node details" onclick={onclose}>&times;</button>
	</header>
	<p class="ref"><a href={`https://www.openstreetmap.org/${ref}`} target="_blank" rel="noreferrer">{ref}</a>{entry?.fetched ? ` - fetched ${entry.fetched}` : ''}</p>
	{#if loading}<p class="msg">Loading...</p>{/if}
	{#if error}<p class="msg err" role="alert">{error}</p>{/if}
	{#if note}<p class="msg">{note}</p>{/if}

	{#if entry}
		<h4>OSM tags (read-only)</h4>
		{#if tags.length}
			<dl>
				{#each tags as [k, v] (k)}
					<dt class:hidden={(entry.local ?? {})[k] === null}>{k}</dt>
					<dd class:hidden={(entry.local ?? {})[k] === null}>{v}</dd>
				{/each}
			</dl>
		{:else}
			<p class="msg">No tags.</p>
		{/if}

		<h4>Local tags</h4>
		<p class="hint">A local value overrides the OSM tag; an empty value hides it.</p>
		{#each rows as row, i (i)}
			<div class="row">
				<input aria-label="Tag key" placeholder="key" bind:value={row.key} />
				<input aria-label="Tag value" placeholder="value (empty hides)" bind:value={row.value} />
				<button type="button" aria-label="Remove tag" onclick={() => (rows = rows.filter((_, j) => j !== i))}>&times;</button>
			</div>
		{/each}
		<button type="button" class="add" onclick={() => (rows = [...rows, { key: '', value: '' }])}>Add tag</button>

		<label class="visited">Visited
			<select bind:value={visited}>
				<option value="">not set</option>
				<option value="yes">yes</option>
				<option value="no">no</option>
				<option value="missing">missing</option>
			</select>
		</label>

		<div class="actions">
			<button type="button" class="primary" disabled={!patch || busy} onclick={save}>Save local tags</button>
			<button type="button" disabled={busy} onclick={refresh}>Refresh from OSM</button>
		</div>

		{#if refreshed}
			<div class="diff" role="status">
				<h4>Refreshed from OSM</h4>
				{#if diffLines.length}
					<ul>{#each diffLines as l (l)}<li>{l}</li>{/each}</ul>
				{:else}
					<p class="msg">No tag changes.</p>
				{/if}
				{#if offers.length}
					<p class="msg">These local tags now match OSM:</p>
					{#each offers as k (k)}
						<div class="offer"><span>{k}</span><button type="button" disabled={busy} onclick={() => drop(k)}>Drop local {k}</button></div>
					{/each}
				{/if}
				<button type="button" onclick={() => (refreshed = null)}>Dismiss</button>
			</div>
		{/if}
	{/if}
</section>

<style>
	.detail {
		border-top: 2px solid #ccc;
		margin-top: 1rem;
		padding-top: 0.5rem;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	h3 {
		flex: 1;
		margin: 0;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}
	h4 {
		margin: 0.75rem 0 0.25rem;
		font-size: 0.9rem;
	}
	.ref,
	.hint,
	.msg {
		margin: 0.25rem 0;
		font-size: 0.85rem;
		color: #666;
	}
	.err {
		color: #b00020;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.1rem 0.75rem;
		margin: 0;
		font-size: 0.85rem;
	}
	dt {
		color: #555;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.hidden {
		text-decoration: line-through;
		opacity: 0.55;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 2.75rem;
		gap: 0.25rem;
		margin-bottom: 0.25rem;
	}
	input,
	select {
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.4rem;
		font-size: 1rem;
		min-width: 0;
	}
	button {
		min-height: 2.75rem;
		padding: 0 0.75rem;
	}
	.close,
	.row button {
		min-width: 2.75rem;
		padding: 0;
		font-size: 1.2rem;
	}
	.visited {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.diff {
		margin-top: 0.75rem;
		padding: 0.5rem;
		background: #f6f8fa;
		border-radius: 4px;
	}
	.diff ul {
		margin: 0 0 0.5rem;
		padding-left: 1rem;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.offer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: space-between;
	}
</style>

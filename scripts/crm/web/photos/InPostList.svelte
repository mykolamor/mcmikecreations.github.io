<script lang="ts">
	import type { createDocSession } from '../doc-session';
	import FixPanel from './FixPanel.svelte';
	import RepoThumb from './RepoThumb.svelte';
	import { photoWrite } from './photo-api';
	import type { Act, Album, FixMode, PostPhoto, WriteResult } from './types';

	let {
		session,
		photos,
		badges,
		act,
		albums,
		busy,
		onlinked,
		onpins
	}: {
		session: ReturnType<typeof createDocSession>;
		photos: PostPhoto[];
		badges: Record<string, string[]>;
		act: Act;
		albums: Album[];
		busy: boolean;
		onlinked: () => void;
		onpins: (key: string) => void;
	} = $props();

	let open = $state<{ key: string; mode: FixMode } | null>(null);
	let checked = $state<Record<string, boolean>>({});
	let shiftBy = $state('');
	let keys = $derived(photos.filter((p) => checked[p.key]).map((p) => p.key));
	let shiftN = $derived(Number(shiftBy));
	let shiftOk = $derived(shiftBy.trim() !== '' && Number.isInteger(shiftN) && shiftN !== 0);

	const toggleFix = (key: string, mode: FixMode) => (open = open?.key === key && open.mode === mode ? null : { key, mode });

	async function remove(key: string) {
		const r = await act(() => photoWrite<WriteResult>(session, 'DELETE', `/api/photos/${encodeURIComponent(key)}`));
		if (r) {
			if (open?.key === key) open = null;
			delete checked[key];
		}
	}
	async function shift() {
		if (!shiftOk || !keys.length) return;
		const r = await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/time', { keys, shiftMinutes: shiftN }));
		if (r) shiftBy = '';
	}
</script>

<section class="list" aria-label={session.ref.kind === 'place' ? 'In this place doc' : 'In this post'}>
	<h3>{session.ref.kind === 'place' ? 'In this place doc' : 'In this post'} ({photos.length})</h3>
	{#if photos.length}
		<div class="shift">
			<label class="all"><input type="checkbox" checked={keys.length === photos.length} onchange={(e) => (checked = Object.fromEntries(photos.map((p) => [p.key, (e.currentTarget as HTMLInputElement).checked])))} /> All</label>
			<label>
				Shift time by
				<input type="text" inputmode="text" bind:value={shiftBy} placeholder="min" size="5" aria-label="Minutes (negative = earlier)" />
				min
			</label>
			<button type="button" onclick={shift} disabled={busy || !shiftOk || !keys.length}>Shift {keys.length || ''}</button>
		</div>
	{:else}
		<p class="empty">No photos yet: select one in the viewer, upload one, or pick one from the library.</p>
	{/if}
	<ul>
		{#each photos as p (p.key)}
			<li>
				<div class="head">
					<label class="tick"><input type="checkbox" bind:checked={checked[p.key]} aria-label={`Choose ${p.key} for the time shift`} /></label>
					<RepoThumb href={p.href} />
					<div class="what">
						<span class="key">{p.key}</span>
						<span class="meta">
							{p.inText ? 'placed in text' : 'not placed in text'} · {p.pins} pin{p.pins === 1 ? '' : 's'}{p.assetId ? '' : ' · not linked'}
						</span>
						{#if badges[p.key]?.length}
							<span class="badges">{#each badges[p.key] as b}<span class="badge">{b}</span>{/each}</span>
						{/if}
					</div>
				</div>
				<div class="actions">
					<button type="button" onclick={() => onpins(p.key)}>Pins</button>
					<button type="button" aria-expanded={open?.key === p.key && open.mode === 'time'} onclick={() => toggleFix(p.key, 'time')}>Fix time</button>
					<button type="button" aria-expanded={open?.key === p.key && open.mode === 'location'} onclick={() => toggleFix(p.key, 'location')}>Fix location</button>
					<button type="button" aria-expanded={open?.key === p.key && open.mode === 'alt'} onclick={() => toggleFix(p.key, 'alt')}>Alt text</button>
					{#if !p.assetId}
						<button type="button" aria-expanded={open?.key === p.key && open.mode === 'find'} onclick={() => toggleFix(p.key, 'find')}>Find in Immich</button>
					{/if}
					<button type="button" onclick={() => remove(p.key)} disabled={busy}>Remove</button>
				</div>
				{#if open?.key === p.key}
					{#key open.mode}
						<FixPanel {session} photo={p} mode={open.mode} {act} {albums} {busy} onclose={() => (open = null)} {onlinked} />
					{/key}
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.shift {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	.shift input[type='text'] {
		font: inherit;
		min-height: 2.75rem;
		width: 4.5rem;
		box-sizing: border-box;
		padding: 0 0.4rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	input[type='checkbox'] {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}
	/* the row checkbox gets a 44 px tap target */
	.tick {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 2.75rem;
		min-height: 2.75rem;
		flex: none;
		cursor: pointer;
	}
	.all {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.75rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-bottom: 1px solid #e3e3e3;
		padding-bottom: 0.6rem;
	}
	.head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.what {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.key {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.meta {
		color: #555;
		font-size: 0.85rem;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.15rem;
	}
	.badge {
		font-size: 0.75rem;
		border: 1px solid #b45309;
		color: #7c2d12;
		background: #fff7ed;
		border-radius: 3px;
		padding: 0 0.3rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.actions button {
		padding: 0 0.6rem;
		font-size: 0.85rem;
	}
	.empty {
		margin: 0;
		color: #555;
	}
</style>

<script module lang="ts">
	import { api } from '../api';
	import type { HikeRow } from '../../server/hikes-index';
	import { hikePosts, type HikePost } from '../write/hike-links';

	// Every post, loaded once per page for the titles shown beside the values (the search loads its own list).
	let titles: Promise<Map<string, string>> | null = null;
	function postTitles(): Promise<Map<string, string>> {
		titles ??= api<{ hikes: HikeRow[] }>('GET', '/api/hikes')
			.then((r) => new Map(hikePosts(r.hikes).map((p) => [`${p.date}-${p.slug}`, p.title])))
			.catch((e) => {
				titles = null; // try again next time
				throw e;
			});
		return titles;
	}
</script>

<script lang="ts">
	import HikeLinkSearch from '../write/HikeLinkSearch.svelte';
	import { REMOVE } from './facts-state';

	// A post's name (`<date>-<slug>`), as alternatives and variants link to: picked by searching the posts.
	let { label, value, onset }: { label: string; value: unknown; onset: (v: unknown, debounce: boolean) => void } = $props();

	const name = $derived(typeof value === 'string' ? value : '');
	let open = $state(false);
	let known = $state<Map<string, string> | null>(null);
	$effect(() => {
		postTitles().then((m) => (known = m), () => (known = null));
	});
	const title = $derived(name ? known?.get(name) : undefined);

	function pick(p: HikePost) {
		onset(`${p.date}-${p.slug}`, false);
		open = false;
	}
</script>

<div class="field">
	<span class="name">{label}</span>
	<div class="current">
		<span>
			{#if !name}—{:else if title}{title} <small>{name}</small>{:else}{name}{#if known}<small class="missing"> (no such post)</small>{/if}{/if}
		</span>
		<button type="button" aria-expanded={open} onclick={() => (open = !open)}>{open ? 'Close' : name ? 'Change' : 'Pick'}</button>
		{#if name}<button type="button" aria-label="Clear" onclick={() => onset(REMOVE, false)}>✕</button>{/if}
	</div>
	{#if open}
		<HikeLinkSearch onpick={pick} onclose={() => (open = false)} />
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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
		font-size: 0.95rem;
	}
	small {
		color: #555;
	}
	.missing {
		color: #b00020;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../api';
	import type { HikeRow } from '../../server/hikes-index';
	import { hikePosts, searchHikes, type HikePost } from './hike-links';

	// `[[` or Link hike: a search over every post. Enter inserts the highlighted one (the first by default), Esc closes
	// and leaves a typed `[[` as it is.
	let { onpick, onclose }: { onpick: (post: HikePost) => void; onclose: () => void } = $props();

	let posts = $state.raw<HikePost[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let query = $state('');
	let active = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let results = $derived(searchHikes(posts, query));

	onMount(() => {
		input?.focus();
		api<{ hikes: HikeRow[] }>('GET', '/api/hikes')
			.then((r) => (posts = hikePosts(r.hikes)))
			.catch((e) => (error = e instanceof Error ? e.message : String(e)))
			.finally(() => (loading = false));
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (results[active]) onpick(results[active]);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length) active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
		}
	}
</script>

<section class="panel" aria-label="Link a hike">
	<header>
		<strong>Link a hike</strong>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>
	</header>
	<input
		bind:this={input}
		bind:value={query}
		oninput={() => (active = 0)}
		{onkeydown}
		type="search"
		placeholder="Title, date or slug"
		aria-label="Search posts"
		aria-controls="hike-link-results"
		aria-activedescendant={results[active] ? `hike-link-${active}` : undefined}
		autocomplete="off"
		enterkeyhint="done"
	/>
	{#if error}
		<p class="err" role="alert">{error}</p>
	{:else if loading}
		<p class="hint">Loading…</p>
	{:else if query.trim() && !results.length}
		<p class="hint">No post matches.</p>
	{/if}
	{#if results.length}
		<ul id="hike-link-results" role="listbox" aria-label="Posts">
			{#each results as p, i (`${p.date}-${p.slug}`)}
				<li id={`hike-link-${i}`} role="option" aria-selected={i === active}>
					<button type="button" class:active={i === active} onclick={() => onpick(p)}>
						<span>{p.title}</span>
						<small>{p.date} · {p.slug}</small>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.panel {
		border: 1px solid #888;
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.x {
		margin-left: auto;
		min-width: 2.75rem;
	}
	input {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.hint {
		margin: 0;
		color: #444;
		font-size: 0.85rem;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 16rem;
		overflow-y: auto;
	}
	li button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		min-height: 2.75rem;
		text-align: left;
		border: 1px solid transparent;
		background: none;
		padding: 0.2rem 0.4rem;
	}
	li button.active {
		border-color: #111;
		background: #eef3ff;
	}
	small {
		color: #444;
	}
</style>

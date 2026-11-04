<script lang="ts">
	import RepoThumb from '../photos/RepoThumb.svelte';
	import type { PostPhoto } from '../photos/types';
	import { PHOTO_DRAG_TYPE } from './media-chips';

	// The post's photos the text doesn't show yet: a tap inserts one at the cursor, dragging one onto a line puts it after that line.
	// Also the side panel's list, which has no close button (`onclose` left out).
	let {
		photos,
		loading,
		error,
		onpick,
		onclose
	}: { photos: PostPhoto[]; loading: boolean; error: string | null; onpick: (p: PostPhoto) => void; onclose?: () => void } = $props();
</script>

<section class="panel" aria-label="Insert a photo">
	<header>
		<strong>Insert a photo</strong>
		<span class="hint">Tap to insert at the cursor, or drag onto a line</span>
		{#if onclose}
			<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>
		{/if}
	</header>
	{#if error}
		<p class="err" role="alert">{error}</p>
	{:else if loading && !photos.length}
		<p class="hint">Loading…</p>
	{:else if !photos.length}
		<p class="hint">Every photo of this post is in the text. Add more in Photos.</p>
	{:else}
		<ul>
			{#each photos as p (p.key)}
				<li>
					<button
						type="button"
						draggable="true"
						title={p.key}
						aria-label={`Insert ${p.key}`}
						onclick={() => onpick(p)}
						ondragstart={(e) => {
							e.dataTransfer?.setData(PHOTO_DRAG_TYPE, p.href);
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
						}}
					>
						<RepoThumb href={p.href} alt={p.alt ?? ''} size={96} />
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
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.hint {
		margin: 0;
		color: #444;
		font-size: 0.85rem;
	}
	.x {
		margin-left: auto;
		min-width: 2.75rem;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
	ul {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		list-style: none;
		margin: 0;
		padding: 0 0 0.2rem;
	}
	li button {
		padding: 2px;
		border: 1px solid transparent;
		background: none;
		display: block;
		cursor: grab;
	}
	li button:hover,
	li button:focus-visible {
		border-color: #111;
	}
</style>

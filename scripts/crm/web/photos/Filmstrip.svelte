<script lang="ts">
	import { thumbUrl, type Asset } from './types';

	let { assets, current, inPost, onpick }: { assets: Asset[]; current: number; inPost: Record<string, string>; onpick: (i: number) => void } = $props();
</script>

<div class="strip" role="listbox" aria-label="Photos of this burst">
	{#each assets as a, i (a.id)}
		<button type="button" data-photo-nav role="option" aria-selected={i === current} aria-label={`${a.fileName}${inPost[a.id] ? ' (in the post)' : ''}`} onclick={() => onpick(i)}>
			<img src={thumbUrl(a.id)} alt="" loading="lazy" />
			{#if inPost[a.id]}<span class="in" aria-hidden="true">✓</span>{/if}
		</button>
	{/each}
</div>

<style>
	.strip {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding: 4px;
	}
	button {
		position: relative;
		flex: none;
		width: 6rem;
		height: 4.5rem;
		padding: 0;
		overflow: hidden;
		background: #ddd;
	}
	button[aria-selected='true'] {
		outline: 3px solid #c25e00;
		outline-offset: 1px;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.in {
		position: absolute;
		left: 3px;
		top: 3px;
		background: #2f6b3a;
		color: #fff;
		font-size: 0.75rem;
		padding: 0 0.3rem;
		border-radius: 3px;
	}
</style>

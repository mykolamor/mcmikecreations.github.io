<script lang="ts">
	import { thumbUrl, type Burst } from './types';

	let { bursts, current, inPost, onpick }: { bursts: Burst[]; current: number; inPost: Record<string, string>; onpick: (i: number) => void } = $props();

	const picked = (b: Burst) => b.assets.filter((a) => inPost[a.id] !== undefined).length;
</script>

<div class="grid" role="listbox" aria-label="Bursts">
	{#each bursts as b, i (b.id)}
		{@const n = picked(b)}
		<button
			type="button"
			role="option"
			class="burst"
			data-photo-nav
			aria-selected={i === current}
			aria-label={`Burst ${i + 1}: ${b.assets.length} photo${b.assets.length === 1 ? '' : 's'}${n ? `, ${n} in the post` : ''}`}
			onclick={() => onpick(i)}
		>
			<img src={thumbUrl(b.assets[0].id)} alt="" loading="lazy" />
			{#if b.assets.length > 1}<span class="count">×{b.assets.length}</span>{/if}
			{#if n}<span class="in">{n}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
		gap: 0.4rem;
		max-height: calc(100vh - 14rem);
		overflow-y: auto;
		padding: 3px;
	}
	.burst {
		position: relative;
		padding: 0;
		height: 4.25rem;
		border: 1px solid #ccc;
		background: #ddd;
		overflow: hidden;
	}
	.burst[aria-selected='true'] {
		outline: 3px solid #c25e00;
		outline-offset: 1px;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.count,
	.in {
		position: absolute;
		font-size: 0.75rem;
		padding: 0 0.3rem;
		border-radius: 3px;
		line-height: 1.3;
	}
	.count {
		right: 3px;
		bottom: 3px;
		background: rgba(255, 255, 255, 0.9);
		color: #111;
	}
	.in {
		left: 3px;
		top: 3px;
		background: #2f6b3a;
		color: #fff;
	}
	@media (max-width: 719px) {
		.grid {
			max-height: 13rem;
		}
	}
</style>

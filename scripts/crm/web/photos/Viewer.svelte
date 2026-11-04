<script lang="ts">
	import type { PhotoAction } from './photo-keys';
	import { swipeAction, swipeDir } from './swipe';
	import { thumbUrl, type Asset } from './types';

	let {
		asset,
		selected,
		busy,
		label,
		onaction
	}: { asset: Asset; selected: boolean; busy: boolean; label: string; onaction: (a: PhotoAction) => void } = $props();

	let start: { x: number; y: number; id: number } | null = null;

	function down(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* pointer already gone */
		}
	}
	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const a = swipeAction(swipeDir(e.clientX - start.x, e.clientY - start.y));
		start = null;
		if (a) onaction(a);
	}

	const time = (t: string) => (/T(\d{2}:\d{2}:\d{2})/.exec(t)?.[1] ?? 'no time');
</script>

<div class="viewer">
	<div class="info">
		<strong>{label}</strong>
		<span class="meta">{time(asset.takenLocal)}{asset.lat === undefined ? ' · no location' : ''} · {asset.fileName}</span>
		<span class="hint">← → photo · ↑ ↓ burst · Space select</span>
	</div>
	<div class="stage" role="presentation" onpointerdown={down} onpointerup={up} onpointercancel={() => (start = null)} onlostpointercapture={() => (start = null)}>
		{#key asset.id}
			<img src={thumbUrl(asset.id, 'preview')} alt={asset.fileName} draggable="false" />
		{/key}
		<button type="button" class="select" aria-pressed={selected} disabled={busy} onclick={() => onaction({ kind: 'toggle' })}>
			{selected ? 'Selected ✓' : 'Select'}
		</button>
	</div>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.info {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.meta,
	.hint {
		color: #555;
		font-size: 0.9rem;
	}
	.hint {
		margin-left: auto;
	}
	.stage {
		position: relative;
		background: #222;
		border-radius: 6px;
		height: min(60vh, 34rem);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		touch-action: none;
		user-select: none;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.select {
		position: absolute;
		right: 0.75rem;
		top: 0.75rem;
		background: #fff;
		border-color: #111;
		font-weight: 600;
	}
	.select[aria-pressed='true'] {
		background: #2f6b3a;
		border-color: #2f6b3a;
		color: #fff;
	}
	@media (max-width: 719px) {
		.hint {
			display: none;
		}
		/* touch-action: none (the swipes) blocks page scrolling over the stage, so on phones it is kept to about a
		   full-width 4:3 photo and the rest of the screen still scrolls; portraits are letterboxed smaller. */
		.stage {
			height: min(52vh, 80vw);
		}
	}
</style>

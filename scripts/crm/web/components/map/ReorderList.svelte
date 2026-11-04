<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { listKey } from '../../map/tools/list-keys';

	let {
		items,
		keyOf,
		selected = null,
		label,
		onselect,
		onmove,
		onremove,
		row
	}: {
		items: T[];
		keyOf: (item: T, i: number) => string;
		selected?: number | null;
		label: string;
		onselect: (i: number) => void;
		onmove: (from: number, to: number) => void;
		onremove: (i: number) => void;
		row: Snippet<[T, number]>;
	} = $props();

	let dragFrom = $state<number | null>(null);
	let over = $state<number | null>(null);

	function onkeydown(e: KeyboardEvent) {
		const cur = selected ?? -1;
		const r = listKey(e.key, (e.target as HTMLElement).closest('button') !== null, cur, items.length);
		if (r.prevent) e.preventDefault();
		if (r.active !== cur) onselect(r.active);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="list" role="listbox" aria-label={label} tabindex="0" {onkeydown}>
	{#each items as item, i (keyOf(item, i))}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<li
			class:active={selected === i}
			class:over={over === i && dragFrom !== i}
			role="option"
			aria-selected={selected === i}
			draggable="true"
			ondragstart={(e) => {
				dragFrom = i;
				e.dataTransfer?.setData('text/plain', String(i));
			}}
			ondragover={(e) => {
				if (dragFrom === null) return;
				e.preventDefault();
				over = i;
			}}
			ondrop={(e) => {
				e.preventDefault();
				if (dragFrom !== null) onmove(dragFrom, i);
				dragFrom = over = null;
			}}
			ondragend={() => (dragFrom = over = null)}
		>
			<span class="grip" aria-hidden="true">&#8942;&#8942;</span>
			<div class="body" onclick={() => onselect(i)} role="presentation">{@render row(item, i)}</div>
			<button type="button" aria-label="Move up" disabled={i === 0} onclick={() => onmove(i, i - 1)}>&uarr;</button>
			<button type="button" aria-label="Move down" disabled={i === items.length - 1} onclick={() => onmove(i, i + 1)}>&darr;</button>
			<button type="button" aria-label="Remove" class="rm" onclick={() => onremove(i)}>&times;</button>
		</li>
	{/each}
</ul>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		outline: none;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid #eee;
		border-radius: 4px;
	}
	li.active {
		background: #e3f2fd;
	}
	li.over {
		box-shadow: 0 -2px 0 #1565c0;
	}
	.grip {
		cursor: grab;
		color: #999;
		width: 1.25rem;
		text-align: center;
		user-select: none;
		letter-spacing: -0.3em;
	}
	.body {
		flex: 1;
		min-width: 0;
		min-height: 2.75rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
		cursor: pointer;
	}
	button {
		width: 2.75rem;
		min-width: 2.75rem;
		height: 2.75rem;
		font-size: 1.1rem;
	}
	.rm {
		color: #b00020;
	}
</style>

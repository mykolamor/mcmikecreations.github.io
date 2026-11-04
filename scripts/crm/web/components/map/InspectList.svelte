<script lang="ts">
	import { listKey } from '../../map/tools/list-keys';
	export type InspectItem = { ref: string; name: string | null; kind: string | null; lat: number; lon: number; inStore: boolean };

	let {
		items,
		busy = false,
		error = null,
		note = null,
		onhighlight,
		onnode,
		oncheckpoint
	}: {
		items: InspectItem[];
		busy?: boolean;
		error?: string | null;
		note?: string | null;
		onhighlight: (item: InspectItem | null) => void;
		onnode: (item: InspectItem) => void;
		oncheckpoint: (item: InspectItem) => void;
	} = $props();

	let active = $state(0);
	let box: HTMLDivElement | undefined = $state();

	// Take focus when results arrive so the arrows work at once, unless the user is typing somewhere.
	$effect(() => {
		if (!items.length || !box) return;
		const el = document.activeElement as HTMLElement | null;
		if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
		box.focus({ preventScroll: true });
		onhighlight(items[Math.min(active, items.length - 1)]);
	});

	function onkeydown(e: KeyboardEvent) {
		const r = listKey(e.key, (e.target as HTMLElement).closest('button') !== null, active, items.length);
		if (r.prevent) e.preventDefault();
		if (r.choose) return onnode(items[active]);
		if (r.active !== active) {
			active = r.active;
			onhighlight(items[active]);
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div bind:this={box} class="inspect" role="listbox" tabindex="0" aria-label="Map objects here" {onkeydown}>
	{#if busy}<p class="msg">Looking up OpenStreetMap...</p>{/if}
	{#if error}<p class="msg err" role="alert">{error}</p>{/if}
	{#if note}<p class="msg">{note}</p>{/if}
	{#if !busy && !error && !items.length}<p class="msg">Nothing tagged here.</p>{/if}
	{#each items as item, i (item.ref)}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="row"
			class:active={i === active}
			role="option"
			aria-selected={i === active}
			tabindex="-1"
			onmouseenter={() => onhighlight(item)}
			onmouseleave={() => onhighlight(null)}
			onfocus={() => onhighlight(item)}
			onclick={() => {
				active = i;
				onhighlight(item);
			}}
		>
			<div class="what">
				<strong>{item.name ?? item.ref}</strong>
				<small>{item.ref}{item.kind ? ` - ${item.kind}` : ''}{item.inStore ? ' - in store' : ''}</small>
			</div>
			<button type="button" onclick={(e) => (e.stopPropagation(), onnode(item))}>Node</button>
			<button type="button" onclick={(e) => (e.stopPropagation(), oncheckpoint(item))}>Checkpoint</button>
		</div>
	{/each}
</div>

<style>
	.inspect {
		min-width: 16rem;
		max-height: 16rem;
		overflow: auto;
		outline: none;
	}
	.msg {
		margin: 0.25rem 0;
	}
	.err {
		color: #b00020;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem;
		border-radius: 4px;
	}
	.row.active {
		background: #e3f2fd;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	small {
		color: #666;
		overflow-wrap: anywhere;
	}
	button {
		min-height: 2.75rem;
		padding: 0 0.5rem;
	}
</style>

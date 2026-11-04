<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { COMMANDS, shortcutList, type WriteCommand } from './commands';

	// `commands`: the doc's own (a place doc has no YouTube).
	let { commands = COMMANDS, onclose }: { commands?: WriteCommand[]; onclose: () => void } = $props();

	let dlg: HTMLDialogElement;
	const keys = untrack(() => shortcutList(commands));

	// Esc closes a modal dialog by itself; a tap outside it (on the backdrop) closes it too.
	onMount(() => dlg.showModal());
</script>

<dialog bind:this={dlg} {onclose} onclick={(e) => e.target === dlg && dlg.close()} aria-label="Keyboard shortcuts">
	<div class="top">
		<h3>Shortcuts</h3>
		<button type="button" onclick={() => dlg.close()}>Close</button>
	</div>
	<table>
		<tbody>
			{#each keys as k (k.shortcut)}
				<tr><td>{k.label}</td><td><kbd>{k.shortcut}</kbd></td></tr>
			{/each}
		</tbody>
	</table>
	<p class="hint">On a Mac, Cmd instead of Ctrl.</p>
</dialog>

<style>
	dialog {
		width: min(26rem, calc(100vw - 2rem));
		max-height: calc(100vh - 3rem);
		box-sizing: border-box;
		border: 1px solid #111;
		border-radius: 6px;
		padding: 1rem;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h3 {
		margin: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 0.5rem;
	}
	td {
		padding: 0.35rem 0;
		border-bottom: 1px solid #ddd;
	}
	td:last-child {
		text-align: right;
	}
	kbd {
		font: inherit;
		font-family: ui-monospace, monospace;
		border: 1px solid #888;
		border-radius: 3px;
		padding: 0 0.3rem;
	}
	.hint {
		color: #555;
		margin: 0.6rem 0 0;
	}
</style>

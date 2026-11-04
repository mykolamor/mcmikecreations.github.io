<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		accept,
		summary,
		buttonLabel = 'Choose file',
		error = null,
		busy = false,
		disabled = false,
		note,
		onfile
	}: {
		title: string;
		accept: string;
		summary: string;
		buttonLabel?: string;
		error?: string | null;
		busy?: boolean;
		disabled?: boolean;
		note?: Snippet;
		onfile: (file: File) => void;
	} = $props();

	let over = $state(false);
	let input: HTMLInputElement;
	const id = `file-${Math.random().toString(36).slice(2, 8)}`;

	function pick(files: FileList | null | undefined) {
		const f = files?.[0];
		if (f && !disabled && !busy) onfile(f);
		if (input) input.value = '';
	}
</script>

<div
	class="card"
	class:over
	role="group"
	aria-label={title}
	ondragover={(e) => {
		e.preventDefault();
		over = true;
	}}
	ondragleave={() => (over = false)}
	ondrop={(e) => {
		e.preventDefault();
		over = false;
		pick(e.dataTransfer?.files);
	}}
>
	<h3>{title}</h3>
	<p class="summary">{summary}</p>
	{@render note?.()}
	<label class="pick" for={id} class:disabled={disabled || busy}>{busy ? 'Uploading…' : buttonLabel}</label>
	<input {id} bind:this={input} type="file" {accept} disabled={disabled || busy} onchange={(e) => pick(e.currentTarget.files)} />
	<span class="hint">or drop a file here</span>
	{#if error}<p class="error" role="alert"><strong>Error:</strong> {error}</p>{/if}
</div>

<style>
	.card {
		border: 1px solid #888;
		border-radius: 4px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.card.over {
		border-style: dashed;
		background: #f3f3f3;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.summary {
		margin: 0;
		overflow-wrap: anywhere;
	}
	input[type='file'] {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		overflow: hidden;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		align-self: flex-start;
	}
	.pick.disabled {
		opacity: 0.6;
		cursor: default;
	}
	input:focus-visible + .hint,
	.pick:focus-within {
		outline: 2px solid #333;
	}
	.hint {
		font-size: 0.85rem;
		color: #444;
	}
	.error {
		margin: 0;
		color: #8a1010;
	}
</style>

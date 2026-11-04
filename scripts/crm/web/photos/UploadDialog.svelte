<script lang="ts">
	import { onMount } from 'svelte';
	import type { createDocSession } from '../doc-session';
	import { photoUpload } from './photo-api';
	import type { Act, WriteResult } from './types';

	let { session, act, onclose, ondone }: { session: ReturnType<typeof createDocSession>; act: Act; onclose: () => void; ondone: (r: WriteResult) => void } = $props();

	let dlg: HTMLDialogElement;
	let file = $state<File | null>(null);
	let target = $state<'stories' | 'topo' | 'other'>('stories');
	let folder = $state('/images/');
	let credit = $state('');
	let sourceUrl = $state('');
	let busy = $state(false);

	onMount(() => dlg.showModal());

	async function send() {
		if (!file) return;
		busy = true;
		const q: Record<string, string> = { target: target === 'other' ? folder.trim() : target };
		if (credit.trim()) q.credit = credit.trim();
		if (sourceUrl.trim()) q.sourceUrl = sourceUrl.trim();
		const f = file;
		const r = await act(() => photoUpload<WriteResult>(session, q, f));
		busy = false;
		if (r) {
			ondone(r);
			dlg.close();
		}
	}
</script>

<dialog bind:this={dlg} onclose={onclose} aria-label="Upload a photo">
	<h3>Upload a photo</h3>
	<label>
		File
		<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
	</label>
	<label>
		Goes to
		<select bind:value={target}>
			<option value="stories">{session.ref.kind === 'place' ? "This place's photos (places)" : "This post's photos (stories)"}</option>
			<option value="topo">Topo maps (/images/hikes/topo/)</option>
			<option value="other">Another shared folder…</option>
		</select>
	</label>
	{#if target === 'other'}
		<label>
			Folder under static/images
			<input type="text" bind:value={folder} placeholder="/images/hikes/…/" autocomplete="off" />
		</label>
	{/if}
	{#if target !== 'stories'}
		<label>
			Credit (optional)
			<input type="text" bind:value={credit} autocomplete="off" />
		</label>
		<label>
			Source URL (optional)
			<input type="url" bind:value={sourceUrl} placeholder="https://…" autocomplete="off" />
		</label>
	{/if}
	<div class="row">
		<button type="button" onclick={send} disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload'}</button>
		<button type="button" onclick={() => dlg.close()}>Cancel</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(30rem, calc(100vw - 2rem));
		box-sizing: border-box;
		border: 1px solid #111;
		border-radius: 6px;
		padding: 1rem;
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	h3 {
		margin: 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	input,
	select {
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	input[type='file'] {
		padding: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.4rem;
	}
</style>

<script lang="ts">
	import type { VideoResult } from '../../server/write-ops';
	import { onDestroy } from 'svelte';
	import { uploadWithProgress } from '../api';
	import { refParams, type createDocSession } from '../doc-session';

	// Uploads an mp4 into the doc's own folder (as the next <date>-NN.mp4); the tab inserts its line when done.
	let {
		session,
		onstart,
		onfail,
		ondone,
		onclose
	}: { session: ReturnType<typeof createDocSession>; onstart: () => void; onfail: () => void; ondone: (r: VideoResult) => void; onclose: () => void } = $props();

	let file = $state<File | null>(null);
	let progress = $state<number | null>(null);
	let error = $state<string | null>(null);
	let ctrl: AbortController | null = null;

	async function send() {
		if (!file || ctrl) return;
		const f = file;
		ctrl = new AbortController();
		const signal = ctrl.signal;
		progress = 0;
		error = null;
		onstart();
		try {
			// guardedWrite flushes pending typing and pauses the save queue while the file goes up.
			const r = await session.guardedWrite((base) =>
				uploadWithProgress<VideoResult>(`/api/write/video?${new URLSearchParams({ ...refParams(session.ref), base })}`, f, (x) => (progress = x), signal)
			);
			ondone(r);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			onfail();
		} finally {
			ctrl = null;
			progress = null;
		}
	}

	// Leaving the tab cancels the upload: the server drops a partial file, so nothing is left half-added.
	onDestroy(() => ctrl?.abort());
</script>

<section class="panel" aria-label="Upload a video">
	<header>
		<strong>Upload a video</strong>
		<button type="button" class="x" aria-label="Close" disabled={progress !== null} onclick={onclose}>×</button>
	</header>
	<label>
		mp4 file (up to 2 GB)
		<input type="file" accept="video/mp4,.mp4" disabled={progress !== null} onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
	</label>
	{#if progress !== null}
		<div class="row">
			<progress max="1" value={progress} aria-label="Upload progress"></progress>
			<span>{Math.round(progress * 100)} %</span>
			<button type="button" onclick={() => ctrl?.abort()}>Cancel</button>
		</div>
	{:else}
		<div class="row">
			<button type="button" onclick={send} disabled={!file}>Upload</button>
		</div>
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
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
	header,
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.x {
		margin-left: auto;
		min-width: 2.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	input {
		font: inherit;
		min-height: 2.75rem;
	}
	progress {
		flex: 1;
		min-width: 8rem;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
</style>

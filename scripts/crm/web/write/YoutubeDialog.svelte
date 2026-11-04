<script lang="ts">
	import type { YoutubeResult } from '../../server/write-ops';
	import type { createDocSession } from '../doc-session';
	import { photoWrite } from '../photos/photo-api';

	// Writes the post's videos.<id> entry (titles, poster); the tab inserts the line when done.
	let {
		session,
		onstart,
		onfail,
		ondone,
		onclose
	}: { session: ReturnType<typeof createDocSession>; onstart: () => void; onfail: () => void; ondone: (r: YoutubeResult) => void; onclose: () => void } = $props();

	let url = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!url.trim() || busy) return;
		busy = true;
		error = null;
		onstart();
		try {
			ondone(await photoWrite<YoutubeResult>(session, 'POST', '/api/write/youtube', { url: url.trim() }));
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			onfail();
		} finally {
			busy = false;
		}
	}
</script>

<section class="panel" aria-label="Insert a YouTube video">
	<header>
		<strong>Insert a YouTube video</strong>
		<button type="button" class="x" aria-label="Close" disabled={busy} onclick={onclose}>×</button>
	</header>
	<form class="row" onsubmit={send}>
		<!-- svelte-ignore a11y_autofocus -->
		<input type="url" bind:value={url} placeholder="https://www.youtube.com/watch?v=…" aria-label="YouTube link" autocomplete="off" autofocus disabled={busy} />
		<button type="submit" disabled={!url.trim() || busy}>{busy ? 'Fetching…' : 'Insert'}</button>
	</form>
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
	input {
		flex: 1;
		min-width: 12rem;
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
</style>

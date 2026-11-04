<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api } from '../api';
	import { refSearch, type createDocSession } from '../doc-session';
	import { previewDocument } from '../preview-doc';

	// The post (or place doc) as the site renders it: the server runs the site's parseMarkdown on the file as it is
	// on disk, so typing still queued is saved first. Shown in a sandboxed frame without scripts: no maps, gallery or pins.
	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	// A hike without a post has no text to show.
	const noPost = untrack(() => session.ref.kind === 'hike');

	let html = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);

	async function refresh() {
		loading = true;
		error = null;
		note = null;
		try {
			await session.queue.flush();
			await session.queue.idle();
			const status = session.queue.status;
			if (status === 'conflict') note = 'Your edits are in conflict and not saved: this is the file on disk.';
			else if (status === 'error') note = 'Some edits could not be saved: this is the file on disk.';
			html = (await api<{ html: string }>('GET', `/api/preview?${refSearch(session.ref)}`)).html;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (!noPost) void refresh();
	});

	const srcdoc = $derived(html === null ? '' : previewDocument(html, location.origin));
</script>

<section class="preview" aria-label="Preview">
	{#if noPost}
		<p>No post yet: the text belongs to a dated visit of this hike.</p>
	{:else}
		<div class="bar">
			<button type="button" onclick={() => void refresh()} disabled={loading}>{loading ? 'Rendering…' : 'Refresh'}</button>
			{#if note}<span class="note">{note}</span>{/if}
		</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		{#if html !== null}
			<iframe title="Preview" sandbox="allow-popups allow-popups-to-escape-sandbox" {srcdoc}></iframe>
		{/if}
	{/if}
</section>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		height: 100%;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.note {
		color: #8a4b00;
	}
	.error {
		color: #b00020;
	}
	iframe {
		width: 100%;
		min-height: 70vh;
		flex: 1;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
	}
</style>

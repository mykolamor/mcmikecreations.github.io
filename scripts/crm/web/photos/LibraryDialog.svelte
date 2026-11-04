<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import RepoThumb from './RepoThumb.svelte';
	import { photoWrite } from './photo-api';
	import type { Act, WriteResult } from './types';

	let { session, act, inPost, onclose }: { session: ReturnType<typeof createDocSession>; act: Act; inPost: Set<string>; onclose: () => void } = $props();

	const LAST_DIR = 'crm.photos.libraryDir';
	type Listing = { dir: string; folders: string[]; images: { href: string }[] };

	let dlg: HTMLDialogElement;
	let listing = $state<Listing | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function go(dir: string) {
		error = null;
		try {
			listing = await api<Listing>('GET', `/api/photos/library?${new URLSearchParams({ dir })}`);
			try {
				localStorage.setItem(LAST_DIR, listing.dir);
			} catch {
				/* storage unavailable */
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			if (dir !== '' && !listing) void go('');
		}
	}
	onMount(() => {
		dlg.showModal();
		let last = 'hikes/topo';
		try {
			last = localStorage.getItem(LAST_DIR) ?? last;
		} catch {
			/* storage unavailable */
		}
		void go(last);
	});

	let crumbs = $derived(listing?.dir ? listing.dir.split('/') : []);
	const up = (i: number) => crumbs.slice(0, i + 1).join('/');

	async function add(href: string) {
		busy = true;
		const r = await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/add', { source: 'library', href }));
		busy = false;
		if (r) dlg.close();
	}
</script>

<dialog bind:this={dlg} onclose={onclose} aria-label="Add from the library">
	<div class="top">
		<h3>Library</h3>
		<button type="button" onclick={() => dlg.close()}>Close</button>
	</div>
	<nav class="crumbs" aria-label="Folder">
		<button type="button" onclick={() => go('')}>images</button>
		{#each crumbs as c, i}
			<span aria-hidden="true">/</span>
			<button type="button" onclick={() => go(up(i))}>{c}</button>
		{/each}
	</nav>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	{#if listing}
		{#if listing.folders.length}
			<div class="folders">
				{#each listing.folders as f (f)}
					<button type="button" onclick={() => go(listing!.dir ? `${listing!.dir}/${f}` : f)}>{f}/</button>
				{/each}
			</div>
		{/if}
		{#if listing.images.length}
			<div class="images">
				{#each listing.images as im (im.href)}
					{@const has = inPost.has(im.href)}
					<button type="button" class="image" disabled={busy || has} onclick={() => add(im.href)} title={im.href}>
						<RepoThumb href={im.href} size={112} />
						<span>{im.href.split('/').pop()}{has ? ' (in post)' : ''}</span>
					</button>
				{/each}
			</div>
		{:else}
			<p class="note">No images in this folder.</p>
		{/if}
	{/if}
</dialog>

<style>
	dialog {
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100vh - 3rem);
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
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h3 {
		margin: 0;
	}
	.crumbs,
	.folders {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.crumbs button {
		padding: 0 0.5rem;
	}
	.images {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
		gap: 0.5rem;
		overflow-y: auto;
		/* scroll the images, not the dialog: Close and the folder path stay in view */
		min-height: 0;
	}
	.image {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.25rem;
		height: auto;
		font-size: 0.75rem;
		overflow-wrap: anywhere;
		background: #fff;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
	.note {
		margin: 0;
		color: #555;
	}
</style>

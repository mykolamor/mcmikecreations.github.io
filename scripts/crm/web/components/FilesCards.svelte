<script lang="ts">
		import type { createDocSession } from '../doc-session';
	import FileCard from './FileCard.svelte';

	import type { FilesState } from '../../server/files';

	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	// Read now as well as on each change: the doc is usually loaded already when this mounts again (back from another tab).
	const currentFiles = () => (session.doc?.files as FilesState | null) ?? null;
	let files = $state<FilesState | null>(currentFiles());
	$effect(() => session.subscribe(() => (files = currentFiles())));

	let errors = $state<Record<string, string | null>>({});
	let busy = $state<Record<string, boolean>>({});
	let scope = $state<'hike' | 'post' | null>(null);
	let hasPost = $derived(session.date !== null);
	// The server defaults to the hike cover only for a route's first post; the UI warns when a later post picks it.
	let isFirst = $derived(files?.firstPost ?? true);

	const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);
	// The thumbnail when it is current (small, and what the site lists), otherwise the cover itself.
	const previewUrl = (c: NonNullable<FilesState['cover']>) =>
		`${c.thumbOk ? `/images/projects/data-viz/hikes/thumb/${c.path.split('/').pop()}` : c.path}?v=${c.bytes}`;
	async function send(key: string, route: string, query: Record<string, string>, file: File) {
		busy[key] = true;
		errors[key] = null;
		try {
			await session.uploadFile(route, query, file);
		} catch (e) {
			errors[key] = e instanceof Error ? e.message : String(e);
		} finally {
			busy[key] = false;
		}
	}
</script>

{#if !files}
	<p>Loading files…</p>
{:else}
	<FileCard
		title="Cover image"
		accept="image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif"
		summary={files.cover ? `${files.cover.path.split('/').pop()} · ${files.cover.w}×${files.cover.h} · ${kb(files.cover.bytes)} · thumbnail ${files.cover.thumbOk ? 'OK' : 'missing or too large'}` : 'No cover yet'}
		error={errors.cover}
		busy={busy.cover}
		onfile={(f) => send('cover', 'cover', scope ? { scope } : {}, f)}
	>
		{#snippet note()}
			{#if files?.cover}
				<img class="preview" src={previewUrl(files.cover)} alt="Cover preview" width="200" loading="lazy" />
			{/if}
			{#if hasPost}
				<label class="scope">
					Use as
					<select bind:value={scope}>
						<option value={null}>Default (first visit: hike cover, later: this post)</option>
						<option value="hike">Hike cover (all posts)</option>
						<option value="post">This post only</option>
					</select>
				</label>
				{#if scope === 'hike' && !isFirst}
					<p class="warn" role="note"><strong>Warning:</strong> this replaces the cover used by the first post.</p>
				{/if}
			{/if}
		{/snippet}
	</FileCard>
	{#if hasPost}
		<FileCard
			title="GPX recording"
			accept=".gpx,application/gpx+xml,application/octet-stream,text/xml,*/*"
			summary={files.gpx ? `${files.gpx.path.split('/').pop()} · ${files.gpx.km.toFixed(1)} km` : 'No GPX yet'}
			error={errors.gpx}
			busy={busy.gpx}
			onfile={(f) => send('gpx', 'gpx', {}, f)}
		/>
	{/if}
	<FileCard
		title="GeoJSON route"
		accept=".json,.geojson,application/json,application/geo+json,application/octet-stream,*/*"
		summary={files.geojson ? `${files.geojson.path.split('/').pop()} · ${files.geojson.km.toFixed(1)} km` : 'No GeoJSON yet'}
		error={errors.geojson}
		busy={busy.geojson}
		onfile={(f) => send('geojson', 'geojson', {}, f)}
	/>
	{#each files.bailouts as b (b.route)}
		<FileCard
			title={`Bailout GPX${b.at ? ` · ${b.at}` : ''}`}
			accept=".gpx,application/gpx+xml,application/octet-stream,text/xml,*/*"
			summary={`${b.route.split('/').pop()} · ${b.km === null ? 'file missing' : `${b.km.toFixed(1)} km`}`}
			buttonLabel="Replace file"
			error={errors[b.route]}
			busy={busy[b.route]}
			onfile={(f) => send(b.route, 'bailout', { route: b.route }, f)}
		/>
	{/each}
{/if}

<style>
	.preview {
		max-width: 100%;
		height: auto;
		border: 1px solid #888;
		align-self: flex-start;
	}
	.warn {
		margin: 0;
	}
	.scope {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	select {
		min-height: 2.75rem;
		max-width: 100%;
	}
</style>

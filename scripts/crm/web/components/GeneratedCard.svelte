<script lang="ts">
	import type { createDocSession } from '../doc-session';
	import { api, streamPost } from '../api';
	import type { FilesState } from '../../server/files';
	import type { TileStatus } from '../../server/tiles';

	type Metrics = { distance?: number; ascent?: number; descent?: number; duration?: number };

	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	const currentFiles = () => (session.doc?.files as FilesState | null) ?? null;
	let files = $state<FilesState | null>(currentFiles());
	let tiles = $state<TileStatus | null>(null);
	let tilesError = $state<string | null>(null);
	let metrics = $state<{ current: Metrics; computed?: Metrics | null } | null>(null);
	let metricsError = $state<string | null>(null);
	let busy = $state({ thumb: false, tiles: false, metrics: false });
	let thumbError = $state<string | null>(null);
	let progress = $state<string[]>([]);
	let downloadError = $state<string | null>(null);

	const q = () => new URLSearchParams({ slug: session.slug, ...(session.date ? { date: session.date } : {}) });
	const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

	async function loadTiles() {
		try {
			tiles = await api<TileStatus>('GET', `/api/tiles/status?${q()}`);
			tilesError = null;
		} catch (e) {
			tilesError = msg(e);
		}
	}
	async function loadMetrics() {
		if (!session.date) return;
		try {
			metrics = await api('GET', `/api/metrics?${q()}`);
			metricsError = null;
		} catch (e) {
			metricsError = msg(e);
		}
	}

	// Both read now as well as on each change: the doc is usually loaded already when this mounts again (back from another tab).
	$effect(() => session.subscribe(() => (files = currentFiles())));
	// metrics follow the doc version (a recompute, an upload or an outside edit changes them) and its route files (`deps`)
	const currentVersion = () => (session.doc ? `${session.doc.version}|${session.doc.deps ?? ''}` : '');
	let version = $state(currentVersion());
	$effect(() => session.subscribe(() => (version = currentVersion())));
	$effect(() => {
		void version;
		if (version) void loadMetrics();
	});
	$effect(() => {
		void loadTiles();
	});

	async function rebuildThumb() {
		busy.thumb = true;
		thumbError = null;
		try {
			const r = await api<{ files: FilesState }>('POST', `/api/thumbnail/rebuild?${q()}`);
			session.setFiles(r.files);
		} catch (e) {
			thumbError = msg(e);
		} finally {
			busy.thumb = false;
		}
	}

	async function downloadTiles() {
		busy.tiles = true;
		downloadError = null;
		progress = [];
		try {
			const last = await streamPost(`/api/tiles/download?${new URLSearchParams({ slug: session.slug })}`, (l) => (progress = [...progress.slice(-199), l]));
			if (last !== 'done') downloadError = last.replace(/^error: /, '') || 'Download ended without a result';
		} catch (e) {
			downloadError = msg(e);
		} finally {
			busy.tiles = false;
			await loadTiles();
		}
	}

	async function recompute() {
		busy.metrics = true;
		metricsError = null;
		try {
			await session.recomputeMetrics();
		} catch (e) {
			metricsError = msg(e);
		} finally {
			busy.metrics = false;
		}
	}

	const fmt = (m: Metrics | null | undefined) =>
		m && Object.keys(m).length
			? `${m.distance !== undefined ? `${(m.distance / 1000).toFixed(2)} km` : '– km'} · ↑ ${m.ascent ?? '–'} m · ↓ ${m.descent ?? '–'} m · ${m.duration !== undefined ? `${Math.floor(m.duration / 60)} h ${m.duration % 60} min` : '– h'}`
			: 'not set';
	const same = (a: Metrics, b: Metrics) => (['distance', 'ascent', 'descent', 'duration'] as const).every((k) => a[k] === b[k]);
</script>

<div class="card" role="group" aria-label="Generated">
	<h3>Generated</h3>

	<div class="row">
		<p class="summary">
			<strong>Thumbnail:</strong>
			{#if !files?.cover}No cover yet{:else if files.cover.thumbOk}OK (up to date){:else}Stale or missing{/if}
		</p>
		<button type="button" disabled={!files?.cover || busy.thumb} onclick={rebuildThumb}>{busy.thumb ? 'Rebuilding…' : 'Rebuild thumbnail'}</button>
		{#if thumbError}<p class="error" role="alert"><strong>Error:</strong> {thumbError}</p>{/if}
	</div>

	<div class="row">
		<p class="summary">
			<strong>Map tiles:</strong>
			{#if tilesError}unknown{:else if !tiles}checking…{:else if tiles.missing === 0}all {tiles.total} present{:else}{tiles.missing} missing of {tiles.total}{/if}
		</p>
		{#if tiles && tiles.missing > 0}
			<ul class="providers">
				{#each Object.entries(tiles.byProvider).filter(([, n]) => n > 0) as [name, n] (name)}<li>{name}: {n} missing</li>{/each}
			</ul>
		{/if}
		<button type="button" disabled={busy.tiles} onclick={downloadTiles}>{busy.tiles ? 'Downloading…' : 'Download tiles'}</button>
		{#if progress.length}
			<pre class="log" aria-live="polite" aria-label="Download progress">{progress.join('\n')}</pre>
		{/if}
		{#if tilesError}<p class="error" role="alert"><strong>Error:</strong> {tilesError}</p>{/if}
		{#if downloadError}<p class="error" role="alert"><strong>Download failed:</strong> {downloadError}</p>{/if}
	</div>

	{#if session.date}
		<div class="row">
			<p class="summary"><strong>Statistics in the post:</strong> {metrics ? fmt(metrics.current) : '…'}</p>
			{#if metrics?.computed}
				<p class="summary"><strong>From the GPX:</strong> {fmt(metrics.computed)} {same(metrics.current, metrics.computed) ? '(same)' : '(differs)'}</p>
			{:else if metrics && files?.gpx}
				<p class="summary">The GPX has no timestamps (planned track): nothing to compute.</p>
			{:else if metrics}
				<p class="summary">No GPX recording yet.</p>
			{/if}
			<button type="button" disabled={!metrics?.computed || busy.metrics} onclick={recompute}>{busy.metrics ? 'Computing…' : 'Recompute'}</button>
			{#if metricsError}<p class="error" role="alert"><strong>Error:</strong> {metricsError}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.card {
		border: 1px solid #888;
		border-radius: 4px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-start;
	}
	.summary,
	.error {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.error {
		color: #8a1010;
	}
	.providers {
		margin: 0;
		padding-left: 1.2rem;
		font-size: 0.9rem;
	}
	button {
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.log {
		margin: 0;
		max-height: 10rem;
		overflow: auto;
		width: 100%;
		box-sizing: border-box;
		font-size: 0.8rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		border: 1px solid #aaa;
		padding: 0.4rem;
	}
</style>

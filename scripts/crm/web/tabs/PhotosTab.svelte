<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import DateInput from '../components/DateInput.svelte';
	import { isValidDate } from '../date-utils';
	import BurstGrid from '../photos/BurstGrid.svelte';
	import Filmstrip from '../photos/Filmstrip.svelte';
	import InPostList from '../photos/InPostList.svelte';
	import LibraryDialog from '../photos/LibraryDialog.svelte';
	import UploadDialog from '../photos/UploadDialog.svelte';
	import Viewer from '../photos/Viewer.svelte';
	import PinEditor from '../pins/PinEditor.svelte';
	import { candidatesQuery, docQuery, photoWrite } from '../photos/photo-api';
	import { photoKey, swallowNavSpaceKeyup, type PhotoAction } from '../photos/photo-keys';
	import type { Act, Candidates, PostPhoto, WriteResult } from '../photos/types';
	import { undoUpdatedOp } from '../photos/undo-updated';

	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	// A post or a place doc holds photos; a hike without a dated visit does not.
	let hasPost = $derived(session.ref.kind !== 'hike');
	let isPlace = $derived(session.ref.kind === 'place');

	// ---- source: Immich candidates (a post: album + dates; a place doc: smart search, prefilled with the title, + optional dates)
	let album = $state('guess');
	let query = $state(untrack(() => (typeof session.doc?.fields['place.title'] === 'string' ? (session.doc.fields['place.title'] as string) : '')));
	let from = $state('');
	let to = $state('');
	let cands = $state.raw<Candidates | null>(null);
	let immichError = $state<string | null>(null);
	let loadingCands = $state(false);
	let bi = $state(0);
	let ai = $state(0);
	let candGen = 0;

	async function loadCandidates() {
		if (!hasPost) return;
		const gen = ++candGen;
		loadingCands = true;
		try {
			const r = await api<Candidates>('GET', `/api/photos/candidates?${candidatesQuery(session.ref, { album, query, from, to })}`);
			if (gen !== candGen) return;
			cands = r;
			immichError = null;
			if (isPlace) query = r.query ?? query;
			else album = r.album?.id ?? 'none';
			from = r.window.from;
			to = r.window.to;
			bi = 0;
			ai = 0;
		} catch (e) {
			if (gen !== candGen) return;
			immichError = e instanceof Error ? e.message : String(e);
		} finally {
			if (gen === candGen) loadingCands = false;
		}
	}
	// A place doc may also drop its date range (both ends cleared): the search then covers all dates.
	const onDate = () => {
		if ((isValidDate(from) && isValidDate(to)) || (isPlace && !from && !to)) void loadCandidates();
	};

	let burst = $derived(cands?.bursts[bi] ?? null);
	let asset = $derived(burst?.assets[ai] ?? null);

	// ---- the post's photos
	let photos = $state.raw<PostPhoto[]>([]);
	let badges = $state.raw<Record<string, string[]>>({});
	let listError = $state<string | null>(null);
	// The doc version the list shows (set only on success, so a failed load is retried on the next change) and the one in flight.
	let listedVersion: string | null = null;
	let listingVersion: string | null = null;
	let listGen = 0;
	let listLoaded = $state(false);

	async function loadList() {
		if (!hasPost) return;
		const gen = ++listGen;
		const v = session.doc?.version ?? null;
		listingVersion = v;
		try {
			const [l, b] = await Promise.all([
				api<{ photos: PostPhoto[] }>('GET', `/api/photos/list?${docQuery(session)}`),
				api<{ badges: Record<string, string[]> }>('GET', `/api/photos/badges?${docQuery(session)}`).catch(() => ({ badges: {} }))
			]);
			if (gen !== listGen) return;
			photos = l.photos;
			badges = b.badges;
			listedVersion = v;
			listLoaded = true;
			listError = null;
		} catch (e) {
			if (gen !== listGen) return;
			listError = e instanceof Error ? e.message : String(e);
		} finally {
			if (gen === listGen) listingVersion = null;
		}
	}
	// Linked asset → key; the list is the truth once loaded (it follows removals made in the list too).
	let inPost = $derived<Record<string, string>>(
		listLoaded ? Object.fromEntries(photos.filter((p) => p.assetId).map((p) => [p.assetId!, p.key])) : (cands?.inPost ?? {})
	);
	let inPostHrefs = $derived(new Set(photos.map((p) => p.href)));

	// ---- writes, notices
	let busy = $state(false);
	/** What the busy overlay says; a write that doesn't name itself shows "Working…". */
	let busyLabel = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let warnings = $state<string[]>([]);
	let info = $state<string | null>(null);
	let stamp = $state<{ previous: string | null } | null>(null);
	/** A shared image's credit went to the end of the text with the upload. */
	let creditAdded = $state(false);
	let pinsFor = $state<string | null>(null);
	let dialog = $state<'upload' | 'library' | null>(null);

	const act: Act = async (fn) => {
		busy = true;
		actionError = null;
		try {
			const r = await fn();
			warnings = (r.immichErrors ?? []).map((x) => `${x.key}: ${x.message}`);
			const notes = [
				r.note,
				r.skipped?.length ? `Skipped (no time): ${r.skipped.join(', ')}` : undefined,
				r.linkError ? `Added, but its Immich link was not saved (${r.linkError}); use Find in Immich to link it` : undefined
			].filter(Boolean);
			info = notes.length ? notes.join(' · ') : null;
			if (r.stamped) {
				stamp = { previous: r.previous ?? null };
				// the stamp changed post.updated: re-read the doc so Details shows it
				await session.load().catch(() => {});
			}
			return r;
		} catch (e) {
			actionError = e instanceof Error ? e.message : String(e);
			return undefined;
		} finally {
			busy = false;
			busyLabel = null;
		}
	};

	function undoStamp() {
		if (!stamp) return;
		session.edit(undoUpdatedOp(stamp.previous), false);
		stamp = null;
	}

	async function toggle() {
		if (!asset || busy) return;
		const a = asset;
		const key = inPost[a.id];
		busyLabel = key !== undefined ? 'Removing the photo…' : 'Adding the photo: downloading from Immich and encoding…';
		const r =
			key !== undefined
				? await act(() => photoWrite<WriteResult>(session, 'DELETE', `/api/photos/${encodeURIComponent(key)}`))
				: await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/add', { source: 'immich', assetId: a.id }));
		// Keep the candidates' map current too: it is what `inPost` shows while the list has not loaded.
		if (r && cands) {
			const next = { ...cands.inPost };
			if (key !== undefined) delete next[a.id];
			else if (r.key && !r.linkError) next[a.id] = r.key;
			cands = { ...cands, inPost: next };
		}
		if (r && !listLoaded) void loadList();
	}

	function run(a: PhotoAction) {
		const bursts = cands?.bursts ?? [];
		if (!bursts.length || busy) return;
		if (a.kind === 'toggle') void toggle();
		else if (a.kind === 'item') ai = Math.max(0, Math.min((burst?.assets.length ?? 1) - 1, ai + a.delta));
		else {
			const next = Math.max(0, Math.min(bursts.length - 1, bi + a.delta));
			if (next !== bi) (bi = next), (ai = 0);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (dialog || e.defaultPrevented || document.querySelector('dialog[open], .leaflet-container:focus-within')) return;
		const a = photoKey(e, e.target as HTMLElement | null);
		if (!a) return;
		e.preventDefault();
		run(a);
	}

	function onkeyup(e: KeyboardEvent) {
		if (swallowNavSpaceKeyup(e, e.target as HTMLElement | null)) e.preventDefault();
	}

	onMount(() => {
		void loadCandidates();
		void loadList();
		// Reload the list whenever the doc version moves (own writes, reloads after a change elsewhere).
		return session.subscribe(() => {
			const v = session.doc?.version ?? null;
			if (v !== null && v !== listedVersion && v !== listingVersion) void loadList();
		});
	});
</script>

<svelte:window {onkeydown} {onkeyup} />

{#if !hasPost}
	<p>Photos belong to a post: open a dated visit of this hike.</p>
{:else}
	<div class="photos">
		<div class="bar" role="toolbar" aria-label="Photo source">
			{#if isPlace}
				<label class="album">
					Search
					<input type="search" bind:value={query} onchange={() => void loadCandidates()} enterkeyhint="search" placeholder="Words Immich should match" />
				</label>
			{:else}
				<label class="album">
					Album
					<select value={album} onchange={(e) => ((album = e.currentTarget.value), void loadCandidates())} disabled={!cands && !!immichError}>
						<option value="guess">Guess from the name</option>
						<option value="none">None (all photos)</option>
						{#each cands?.albums ?? [] as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
					</select>
				</label>
			{/if}
			<DateInput label="From" bind:value={from} onchange={onDate} />
			<DateInput label="To" bind:value={to} onchange={onDate} />
			<span class="spacer"></span>
			<button type="button" onclick={() => (dialog = 'upload')}>Upload</button>
			<button type="button" onclick={() => (dialog = 'library')}>Library</button>
		</div>

		{#if immichError}
			<div class="banner" role="alert">
				<strong>Immich:</strong> {immichError}. Upload, Library and pins still work.
				<button type="button" onclick={loadCandidates}>Retry</button>
			</div>
		{/if}
		{#if stamp}
			<div class="notice" role="status">
				Marked as updated today — <button type="button" onclick={undoStamp}>Undo</button>
				<button type="button" class="x" aria-label="Dismiss" onclick={() => (stamp = null)}>×</button>
			</div>
		{/if}
		{#if creditAdded}
			<div class="notice" role="status">
				Credit added at the end of the text
				<button type="button" class="x" aria-label="Dismiss" onclick={() => (creditAdded = false)}>×</button>
			</div>
		{/if}
		{#if warnings.length}
			<div class="warn" role="status">
				Immich was not updated:
				<ul>{#each warnings as w}<li>{w}</li>{/each}</ul>
				<button type="button" class="x" aria-label="Dismiss" onclick={() => (warnings = [])}>×</button>
			</div>
		{/if}
		{#if info}<p class="info" role="status">{info}</p>{/if}
		{#if actionError}<p class="err" role="alert">{actionError}</p>{/if}

		<div class="cols">
			<section class="source" aria-label="Immich bursts">
				{#if cands}
					<p class="sum">{cands.query !== undefined ? `“${cands.query}”` : cands.album ? cands.album.name : 'All photos'} · {cands.bursts.reduce((n, b) => n + b.assets.length, 0)} photos · {cands.bursts.length} bursts</p>
					<BurstGrid bursts={cands.bursts} current={bi} {inPost} onpick={(i) => ((bi = i), (ai = 0))} />
				{:else if loadingCands}
					<p class="sum">Loading Immich photos…</p>
				{/if}
			</section>

			<section class="view" aria-label="Viewer">
				{#if asset && burst && cands}
					<Viewer {asset} selected={inPost[asset.id] !== undefined} {busy} label={`Burst ${bi + 1} of ${cands.bursts.length} · photo ${ai + 1} of ${burst.assets.length}`} onaction={run} />
					{#if burst.assets.length > 1}
						<Filmstrip assets={burst.assets} current={ai} {inPost} onpick={(i) => (ai = i)} />
					{/if}
				{:else if cands}
					<p class="sum">{isPlace ? 'No photos found. Try other words or widen the dates.' : 'No photos in this window. Pick another album or widen the dates.'}</p>
				{/if}
			</section>

			<aside class="post">
				{#if listError}<p class="err" role="alert">{listError}</p>{/if}
				<InPostList
					{session}
					{photos}
					{badges}
					{act}
					{busy}
					albums={cands?.albums ?? []}
					onlinked={() => void loadList()}
					onpins={(k) => (pinsFor = k)}
				/>
			</aside>
		</div>
	</div>

	{#if busy}
		<!-- Blocks clicks at once; seen only after a moment, so a quick save doesn't flash it. -->
		<div class="busy" role="status" aria-live="polite">
			<div class="busy-box"><span class="spinner" aria-hidden="true"></span>{busyLabel ?? 'Working…'}</div>
		</div>
	{/if}

	{#if pinsFor}
		<PinEditor {session} {photos} key={pinsFor} onclose={() => (pinsFor = null)} />
	{/if}
	{#if dialog === 'upload'}
		<UploadDialog {session} {act} onclose={() => (dialog = null)} ondone={(r) => (creditAdded = r.caption !== undefined)} />
	{:else if dialog === 'library'}
		<LibraryDialog {session} {act} inPost={inPostHrefs} onclose={() => (dialog = null)} />
	{/if}
{/if}

<style>
	.photos {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-end;
	}
	.album {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	select,
	input[type='search'] {
		font: inherit;
		min-height: 2.75rem;
		max-width: 16rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	input[type='search'] {
		padding: 0 0.5rem;
		box-sizing: border-box;
	}
	.spacer {
		flex: 1;
	}
	.banner,
	.notice,
	.warn {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		border: 1px solid #111;
		border-radius: 4px;
		padding: 0.3rem 0.6rem;
	}
	.banner {
		border-width: 2px;
		background: #fff7ed;
	}
	.warn {
		background: #fffbe6;
	}
	.warn ul {
		margin: 0;
		padding-left: 1.2rem;
		flex-basis: 100%;
		order: 1;
	}
	.x {
		margin-left: auto;
		min-width: 2.75rem;
		padding: 0 0.7rem;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
	.info,
	.sum {
		margin: 0;
		color: #444;
	}
	.busy {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(255 255 255 / 0.6);
		cursor: progress;
		opacity: 0;
		animation: busy-in 0.15s ease-out 0.3s forwards;
	}
	.busy-box {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: calc(100vw - 2rem);
		box-sizing: border-box;
		padding: 0.75rem 1.25rem;
		background: #fff;
		border: 2px solid #111;
		border-radius: 6px;
		font-weight: 600;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
	}
	.spinner {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		border: 3px solid #ccc;
		border-top-color: #111;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes busy-in {
		to {
			opacity: 1;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 3s;
		}
	}
	.cols {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
		align-items: start;
	}
	.source,
	.view,
	.post {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	@media (min-width: 720px) {
		.cols {
			grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
		}
		.post {
			grid-column: 1 / -1;
		}
	}
	@media (min-width: 1200px) {
		.cols {
			grid-template-columns: 18rem minmax(0, 1fr) 22rem;
		}
		.post {
			grid-column: auto;
		}
	}
</style>

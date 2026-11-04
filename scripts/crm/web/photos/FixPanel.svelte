<script lang="ts">
	import L from 'leaflet';
	import 'leaflet/dist/leaflet.css';
	import { onMount, untrack } from 'svelte';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import DateInput from '../components/DateInput.svelte';
	import { docQuery, photoWrite } from './photo-api';
	import { thumbUrl, type Act, type Album, type FixMode, type PostPhoto, type WriteResult } from './types';

	let {
		session,
		photo,
		mode,
		act,
		albums,
		busy,
		onclose,
		onlinked
	}: {
		session: ReturnType<typeof createDocSession>;
		photo: PostPhoto;
		mode: FixMode;
		act: Act;
		albums: Album[];
		/** A write is running (here or elsewhere in the tab): the write buttons wait. */
		busy: boolean;
		onclose: () => void;
		onlinked: () => void;
	} = $props();

	// ---- time
	// The panel is keyed per photo and mode: fields start from the photo as it was when opened.
	let taken = $state(untrack(() => photo.taken ?? ''));
	async function saveTime() {
		const r = await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/time', { keys: [photo.key], taken: taken.trim() }));
		if (r) onclose();
	}

	// ---- location
	let mapEl = $state<HTMLDivElement | null>(null);
	let pick = $state<{ lat: number; lon: number } | null>(null);
	async function location(body: Record<string, unknown>) {
		const r = await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/location', { key: photo.key, ...body }));
		if (r) onclose();
	}
	onMount(() => {
		if (mode !== 'location' || !mapEl) return;
		const map = L.map(mapEl, { zoomControl: true });
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
		let marker: L.CircleMarker | null = null;
		const put = (lat: number, lon: number, color: string) => {
			marker?.remove();
			marker = L.circleMarker([lat, lon], { radius: 9, color, weight: 3, fillOpacity: 0.4 }).addTo(map);
		};
		if (photo.lat !== undefined && photo.lon !== undefined) {
			map.setView([photo.lat, photo.lon], 15);
			put(photo.lat, photo.lon, '#555');
		} else map.setView([47.5, 12.5], 8);
		map.on('click', (e: L.LeafletMouseEvent) => {
			pick = { lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) };
			put(pick.lat, pick.lon, '#c25e00');
		});
		// The route gives the tap some context; without a photo position the view fits it.
		let dead = false;
		api<{ routeUrl: string | null; origin: { lat: number; lon: number } | null }>('GET', `/api/map?${docQuery(session)}`)
			.then(async (m) => {
				if (dead) return;
				if (m.routeUrl) {
					const geo = await fetch(m.routeUrl).then((r) => (r.ok ? r.json() : null));
					if (dead || !geo) return;
					const layer = L.geoJSON(geo, { style: { color: '#1565c0', weight: 3 } }).addTo(map);
					if (photo.lat === undefined) map.fitBounds(layer.getBounds(), { padding: [10, 10] });
				} else if (m.origin && photo.lat === undefined) map.setView([m.origin.lat, m.origin.lon], 13);
			})
			.catch(() => {});
		return () => {
			dead = true;
			map.remove();
		};
	});

	// ---- alt
	let alt = $state(untrack(() => photo.alt ?? ''));
	async function saveAlt(text: string | null) {
		const r = await act(() => photoWrite<WriteResult>(session, 'POST', '/api/photos/alt', { key: photo.key, text: text?.trim() ? text.trim() : null }));
		if (r) onclose();
	}

	// ---- find in Immich
	type Ranked = { assetId: string; distance: number; hamming: number };
	let findAlbum = $state('guess');
	let findFrom = $state('');
	let findTo = $state('');
	let ranked = $state<Ranked[] | null>(null);
	let chosen = $state<string | null>(null);
	let accepted = $state(false);
	let searching = $state(false);
	let findError = $state<string | null>(null);
	async function find() {
		searching = true;
		findError = null;
		try {
			const extra: Record<string, string> = { key: photo.key, album: findAlbum };
			if (findFrom && findTo) Object.assign(extra, { from: findFrom, to: findTo });
			const r = await api<{ best?: { assetId: string }; accepted: boolean; ranked: Ranked[] }>('GET', `/api/photos/find?${docQuery(session, extra)}`);
			ranked = r.ranked;
			accepted = r.accepted;
			chosen = r.accepted && r.best ? r.best.assetId : null;
		} catch (e) {
			findError = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}
	async function link() {
		if (!chosen) return;
		const id = chosen;
		const r = await act(async () => {
			await api('POST', `/api/photos/link?${docQuery(session)}`, { key: photo.key, assetId: id });
			return { version: session.doc?.version ?? '' };
		});
		if (r) {
			onlinked();
			onclose();
		}
	}
	onMount(() => {
		if (mode === 'find') void find();
	});
</script>

<div class="fix" role="group" aria-label={`Fix ${photo.key}`}>
	{#if mode === 'time'}
		<label>
			Taken (local time with offset)
			<input type="text" bind:value={taken} placeholder="2026-09-27T11:18:16+02:00" autocomplete="off" />
		</label>
		<div class="row">
			<button type="button" onclick={saveTime} disabled={busy || !taken.trim()}>Save time</button>
			<button type="button" onclick={onclose}>Cancel</button>
		</div>
	{:else if mode === 'location'}
		<p class="note">Tap the map to set the position{photo.located === 'track' ? ' (now: from the track)' : ''}.</p>
		<div class="minimap" bind:this={mapEl} aria-label="Pick a position"></div>
		<div class="row">
			<button type="button" disabled={busy || !pick} onclick={() => pick && location({ lat: pick.lat, lon: pick.lon })}>
				{pick ? `Set ${pick.lat.toFixed(5)}, ${pick.lon.toFixed(5)}` : 'Set position'}
			</button>
			{#if session.ref.kind === 'post'}<button type="button" onclick={() => location({ fromTrack: true })} disabled={busy}>From track</button>{/if}
			<button type="button" onclick={() => location({ drop: true })} disabled={busy || photo.lat === undefined}>Drop</button>
			<button type="button" onclick={onclose}>Cancel</button>
		</div>
	{:else if mode === 'alt'}
		<label>
			Alt text (the image's alt attribute; the caption stays the figure caption)
			<textarea rows="3" bind:value={alt}></textarea>
		</label>
		<div class="row">
			<button type="button" onclick={() => saveAlt(alt)} disabled={busy || !alt.trim()}>Save alt text</button>
			<button type="button" onclick={() => saveAlt(null)} disabled={busy || photo.alt === undefined}>Remove</button>
			<button type="button" onclick={onclose}>Cancel</button>
		</div>
	{:else}
		<div class="row widen">
			<!-- A place doc's candidates come from a smart search for its title, not from an album. -->
			{#if session.ref.kind !== 'place'}
				<label>
					Album
					<select bind:value={findAlbum}>
						<option value="guess">Guessed album</option>
						<option value="none">None (all photos)</option>
						{#each albums as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
					</select>
				</label>
			{/if}
			<DateInput label="From" bind:value={findFrom} />
			<DateInput label="To" bind:value={findTo} />
			<button type="button" onclick={find} disabled={searching}>{searching ? 'Searching…' : 'Search again'}</button>
		</div>
		{#if findError}<p class="err" role="alert">{findError}</p>{/if}
		{#if ranked}
			{#if !ranked.length}
				<p class="note">
					{session.ref.kind === 'place'
						? "No candidates for the place's title. Clear both dates to search all dates."
						: 'No candidates. Widen the search: album "None" and a longer date range.'}
				</p>
			{:else}
				<p class="note">{accepted ? 'Best match preselected.' : 'No confident match: pick one, or widen the search.'} Lower distance = closer.</p>
				<div class="ranked" role="radiogroup" aria-label="Candidates">
					{#each ranked as m (m.assetId)}
						<button type="button" role="radio" aria-checked={chosen === m.assetId} onclick={() => (chosen = m.assetId)}>
							<img src={thumbUrl(m.assetId)} alt="" loading="lazy" />
							<span>{m.distance.toFixed(4)} · h{m.hamming}</span>
						</button>
					{/each}
				</div>
			{/if}
		{/if}
		<div class="row">
			<button type="button" onclick={link} disabled={busy || !chosen}>Link to this photo</button>
			<button type="button" onclick={onclose}>Cancel</button>
		</div>
	{/if}
</div>

<style>
	.fix {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #fafafa;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	input,
	textarea,
	select {
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		max-width: 100%;
	}
	textarea {
		padding: 0.4rem 0.5rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: flex-end;
	}
	.minimap {
		height: 16rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
		color: #444;
	}
	.err {
		margin: 0;
		font-weight: 600;
	}
	.ranked {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 0.4rem;
	}
	.ranked button {
		display: flex;
		flex-direction: column;
		padding: 2px;
		height: auto;
		font-size: 0.75rem;
		background: #fff;
	}
	.ranked button[aria-checked='true'] {
		outline: 3px solid #c25e00;
	}
	.ranked img {
		width: 100%;
		height: 4rem;
		object-fit: cover;
	}
</style>

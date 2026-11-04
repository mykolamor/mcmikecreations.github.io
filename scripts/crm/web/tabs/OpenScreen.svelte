<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../api';
	import { gapBadges, type Gaps } from '../../shared/translation-gaps';
	import DateInput from '../components/DateInput.svelte';
	import { isValidDate } from '../date-utils';
	import { isPlaceSlug } from '../../shared/place-slug';
	import type { DocRef } from '../../server/doc-ref';
	import { OTHER_LANGS } from '$lib/i18n/languages';
	import { HIKE_SORTS, HIKE_SORT_KEY, isHikeSort, sortHikes, type HikeSort } from '../hike-sort';
	import { readPref, writePref } from '../map/storage';

	type HikeRow = {
		slug: string;
		name: string;
		hasGeojson: boolean;
		hasGpx: boolean;
		hasFacts: boolean;
		gaps: Gaps;
		posts: { date: string; path: string; title: string; hasFacts: boolean; gaps: Gaps }[];
		postlessDates: string[];
	};
	type PlaceRow = { slug: string; title: string; gaps: Gaps };
	let { onopen }: { onopen: (ref: DocRef) => void } = $props();
	const openHike = (slug: string, date: string | null) => onopen(date ? { kind: 'post', slug, date } : { kind: 'hike', slug });

	let hikes = $state<HikeRow[]>([]);
	let places = $state<PlaceRow[]>([]);
	let postCount = $state<number | null>(null);
	let error = $state<string | null>(null);
	let query = $state('');
	let withoutPost = $state(false);
	const savedSort = readPref(HIKE_SORT_KEY);
	let sortBy = $state<HikeSort>(isHikeSort(savedSort) ? savedSort : 'visit');
	let form = $state<{ slug: string; kind: 'create' | 'visit' } | null>(null);
	let formDate = $state('');
	let newSlug = $state('');
	let newName = $state('');
	let newDate = $state('');
	let busy = $state(false);
	let placeForm = $state(false);
	let placeSlug = $state('');
	let placeTitle = $state('');
	let placeDescription = $state('');
	let placeError = $state<string | null>(null);

	async function load() {
		try {
			const r = await api<{ postCount: number; hikes: HikeRow[]; places: PlaceRow[] }>('GET', '/api/hikes');
			hikes = r.hikes;
			places = r.places;
			postCount = r.postCount;
		} catch (e) {
			error = (e as Error).message;
		}
	}
	onMount(load);

	let shown = $derived(
		sortHikes(
			hikes.filter((h) => {
				const q = query.trim().toLowerCase();
				if (q && !h.name.toLowerCase().includes(q) && !h.slug.includes(q)) return false;
				return !withoutPost || h.postlessDates.length > 0;
			}),
			sortBy
		)
	);

	let shownPlaces = $derived(
		places.filter((p) => {
			const q = query.trim().toLowerCase();
			return !q || p.title.toLowerCase().includes(q) || p.slug.includes(q);
		})
	);

	function startForm(h: HikeRow, kind: 'create' | 'visit') {
		form = { slug: h.slug, kind };
		formDate = kind === 'create' ? (h.postlessDates[0] ?? '') : '';
		error = null;
	}

	async function run(path: string, body: { slug: string; date: string; name?: string }) {
		busy = true;
		error = null;
		try {
			await api('POST', path, body);
			openHike(body.slug, body.date);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	const submitPost = () => form && run('/api/posts', { slug: form.slug, date: formDate });
	const submitHike = () => run('/api/hikes', { slug: newSlug, name: newName, date: newDate });
	let slugOk = $derived(/^[a-z0-9][a-z0-9_]*$/.test(newSlug));

	// The site requires a title and a description; the server refuses the same slugs as `isPlaceSlug` and says why.
	let placeSlugOk = $derived(isPlaceSlug(placeSlug));
	/** Opens or closes the form; closing it (Cancel too) drops what was typed, so it opens empty next time. */
	function togglePlaceForm(show: boolean) {
		placeForm = show;
		placeError = null;
		if (show) return;
		placeSlug = '';
		placeTitle = '';
		placeDescription = '';
	}
	async function submitPlace() {
		busy = true;
		placeError = null;
		try {
			const r = await api<{ slug: string }>('POST', '/api/places', { slug: placeSlug, title: placeTitle, description: placeDescription });
			onopen({ kind: 'place', slug: r.slug });
		} catch (e) {
			placeError = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<section class="open">
	<div class="list">
		<div class="bar">
			<h2>{postCount === null ? 'Hikes' : `${postCount} posts`}</h2>
			<input type="search" placeholder="Search name or slug" aria-label="Search hikes and places" bind:value={query} />
			<label class="check"><input type="checkbox" bind:checked={withoutPost} /> Without post only</label>
			<label class="sort"
				>Sort by
				<select bind:value={sortBy} onchange={() => writePref(HIKE_SORT_KEY, sortBy)}>
					{#each HIKE_SORTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
				</select></label
			>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<ul>
			{#each shown as h (h.slug)}
				<li>
					<div class="head">
						<strong>{h.name}</strong> <code>{h.slug}</code>
						{#if h.postlessDates.length}<span class="badge">No post: {h.postlessDates.join(', ')}</span>{:else if !h.posts.length}<span class="badge">No post</span>{/if}
						{#if !h.hasGeojson}<span class="badge">No route</span>{/if}
						{#if h.hasFacts}<span class="badge facts" title={`${h.slug}.hike.json has a facts sheet`}>Facts</span>{/if}
						{#each gapBadges(h.gaps) as text (text)}<span class="badge gap" title="The hike's own texts still missing in this language">{text}</span>{/each}
					</div>
					{#if h.posts.length}
						<div class="posts">
							{#each h.posts as p (p.date)}
								<button type="button" onclick={() => openHike(h.slug, p.date)}
									>{p.date}<span class="t"> {p.title}</span>{#if p.hasFacts}<span class="facts-mark" title="The post's front matter has facts">Facts</span>{/if}{#each gapBadges(p.gaps) as text (text)}<span class="facts-mark gap" title="The post's own texts still missing in this language">{text}</span>{/each}</button
								>
							{/each}
						</div>
					{/if}
					<div class="actions">
						{#if h.postlessDates.length}<button type="button" onclick={() => startForm(h, 'create')}>Create post</button>{/if}
						<button type="button" onclick={() => startForm(h, 'visit')}>New visit post</button>
						<button type="button" onclick={() => openHike(h.slug, null)}>Open hike only</button>
					</div>
					{#if form?.slug === h.slug}
						<form class="inline" onsubmit={(e) => (e.preventDefault(), submitPost())}>
							<DateInput bind:value={formDate} label={form.kind === 'create' ? 'Post date' : 'Visit date'} />
							<button type="submit" disabled={busy || !isValidDate(formDate)}>{form.kind === 'create' ? 'Create post' : 'Create visit post'}</button>
							<button type="button" onclick={() => (form = null)}>Cancel</button>
						</form>
					{/if}
				</li>
			{:else}
				<li>{postCount === null ? 'Loading…' : 'No hikes match.'}</li>
			{/each}
		</ul>

		<div class="bar places">
			<h2>Places</h2>
			<button type="button" aria-expanded={placeForm} onclick={() => togglePlaceForm(!placeForm)}>+ New place doc</button>
		</div>
		{#if placeForm}
			<form class="place-form" onsubmit={(e) => (e.preventDefault(), submitPlace())}>
				<label
					>Slug <input bind:value={placeSlug} placeholder="lowercase-with-dashes" autocapitalize="none" aria-invalid={placeSlug !== '' && !placeSlugOk} aria-describedby="place-slug-hint" /></label
				>
				{#if placeSlug !== '' && !placeSlugOk}<span id="place-slug-hint" class="hint">Lowercase letters and digits, single <code>-</code> or <code>_</code> between them.</span>{/if}
				<label>Title <input bind:value={placeTitle} /></label>
				<label>Description <textarea rows="3" bind:value={placeDescription}></textarea></label>
				{#if placeError}<p class="error" role="alert">{placeError}</p>{/if}
				<div class="inline">
					<button type="submit" disabled={busy || !placeSlugOk || !placeTitle.trim() || !placeDescription.trim()}>Create place doc</button>
					<button type="button" onclick={() => togglePlaceForm(false)}>Cancel</button>
				</div>
			</form>
		{/if}
		<ul>
			{#each shownPlaces as p (p.slug)}
				<li>
					<button type="button" class="place" onclick={() => onopen({ kind: 'place', slug: p.slug })}><strong>{p.title}</strong> <code>{p.slug}</code>{#each gapBadges(p.gaps) as text (text)}<span class="facts-mark gap" title="Still missing in this language">{text}</span>{/each}</button>
				</li>
			{:else}
				<li>{postCount === null ? 'Loading…' : places.length ? 'No places match.' : 'No place docs yet.'}</li>
			{/each}
		</ul>
	</div>

	<aside class="card">
		<h3>New hike from scratch</h3>
		<form onsubmit={(e) => (e.preventDefault(), submitHike())}>
			<label>Slug <input bind:value={newSlug} placeholder="lowercase_with_underscores" autocapitalize="none" aria-invalid={newSlug !== '' && !slugOk} /></label>
			<label>Name <input bind:value={newName} /></label>
			<DateInput bind:value={newDate} label="Date" />
			<button type="submit" disabled={busy || !slugOk || !newName.trim() || !isValidDate(newDate)}>Create hike</button>
		</form>
		{#if OTHER_LANGS.length}
			<!-- The site's labels and tag texts per language (the Strings view). -->
			<h3 class="tables">Label tables</h3>
			<div class="links">
				{#each OTHER_LANGS as l (l)}
					<a href={`?${new URLSearchParams({ strings: l })}`}>Label tables · {l.toUpperCase()}</a>
				{/each}
			</div>
		{/if}
	</aside>
</section>

<style>
	.open {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: 1.5rem;
		align-items: start;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	h2,
	h3 {
		margin: 0;
	}
	.bar input[type='search'],
	form input:not([type='checkbox']),
	form textarea {
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	/* After the shared rule above, which it must override (same specificity). */
	form textarea {
		padding: 0.4rem 0.5rem;
		resize: vertical;
	}
	/* A long slug wraps instead of widening the list on a phone. */
	code {
		overflow-wrap: anywhere;
	}
	.places {
		margin-top: 1.5rem;
	}
	.place-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.6rem;
		max-width: 30rem;
	}
	.place-form label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	.hint {
		font-size: 0.85rem;
	}
	.place {
		text-align: left;
		max-width: 100%;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
	}
	.check input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.sort select {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
	}
	li {
		border-top: 1px solid #ccc;
		padding: 0.6rem 0;
	}
	.badge {
		border: 1px solid #111;
		border-radius: 3px;
		padding: 0 0.3rem;
		font-size: 0.8rem;
		margin-left: 0.3rem;
	}
	.posts,
	.actions,
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
		align-items: flex-end;
	}
	.t {
		color: #555;
	}
	/* Filled, so "has facts" stands apart from the outlined "No …" badges. */
	.badge.facts {
		background: #111;
		color: #fff;
	}
	/* What a translation still lacks, in the colour of the tab dots. */
	.gap {
		border-color: #c75b00;
		color: #9a4600;
	}
	.facts-mark {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0 0.25rem;
		border: 1px solid currentColor;
		border-radius: 3px;
		font-size: 0.75rem;
	}
	.error {
		border: 2px solid #111;
		padding: 0.4rem 0.6rem;
	}
	.card {
		border: 1px solid #888;
		border-radius: 6px;
		padding: 1rem;
	}
	.card form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.card label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	.tables {
		margin-top: 1.25rem;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}
	.links a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid #888;
		border-radius: 4px;
		color: inherit;
	}
	@media (max-width: 719px) {
		.open {
			grid-template-columns: 1fr;
		}
	}
</style>

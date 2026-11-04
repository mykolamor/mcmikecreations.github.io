<script lang="ts">
	import { onMount } from 'svelte';
	import type { Lang } from '$lib/hikes/facts-schema';
	import { FACTS, type Spec } from '$lib/hikes/facts-spec';
	import { OTHER_LANGS } from '$lib/i18n/languages';
	import type { FieldOp } from '../../shared/ops';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import FactsField from '../facts/FactsField.svelte';
	import FactsPreview from '../facts/FactsPreview.svelte';
	import NearDuplicates from '../facts/NearDuplicates.svelte';
	import RouteList from '../facts/RouteList.svelte';
	import { editOp, localFacts, moveOp, shownOps, statedTexts, type FactsCtx, type Scope } from '../facts/facts-state';
	import { POST_ONLY, factsLang, fieldLabel, hasContent, textEdit } from '../facts/form-model';
	import { libraryClient, touchesRecord, type LibraryState, type SharedCtx } from '../facts/shared';
	import { secondLang } from '../lang.svelte';
	import { refSearch } from '../doc-session';
	import FillButton from '../fill/FillButton.svelte';
	import { drafts } from '../fill/drafts.svelte';
	import { conflictOf, gatherFacts, type FillResult } from '../fill/fill';
	import { at, type Path } from '../../shared/tree';

	let { session }: { session: ReturnType<typeof createDocSession> } = $props();

	// English plus the CRM's second language (picked in the app header); English alone when the site has no other.
	const lang = $derived<Lang>(factsLang(secondLang(), OTHER_LANGS));

	// The facts ops not in the doc yet (queued or in flight), re-read on every doc / queue change: the session is not reactive.
	let ops = $state.raw<FieldOp[]>([]);
	let rev = $state(0);
	// "This visit" edits the post's facts over the hike's; a hike without a post has only its defaults.
	const hasPost = $derived.by(() => {
		void rev;
		return session.doc?.date != null;
	});
	let picked = $state<Scope>('hike');
	const scope = $derived<Scope>(hasPost ? picked : 'hike');
	// The selected route list entry: its index in the scope's merged list (the profile shows it).
	let selectedLeg = $state<number | null>(null);
	function pickScope(s: Scope) {
		if (s !== scope) selectedLeg = null;
		picked = s;
	}
	// A doc this tab didn't save (reloaded, or my edits discarded) may hold another list: the selection goes.
	let reloads = 0;
	/** The doc's `deps` last seen: a change reads the facts library again. */
	let deps: string | null = null;
	const facts = $derived.by(() => {
		void rev;
		return localFacts(session.doc, ops, scope) as Record<string, unknown> | undefined;
	});
	// What the visit inherits: the hike's facts with their edits.
	const hikeFacts = $derived.by(() => {
		void rev;
		return scope === 'post' ? (localFacts(session.doc, ops, 'hike') as Record<string, unknown> | undefined) : undefined;
	});
	const loaded = $derived.by(() => {
		void rev;
		return session.doc != null;
	});
	// Sections with content start open; after that each stays as the author leaves it.
	let opened = $state<Record<string, boolean> | null>(null);

	onMount(() => {
		const sync = () => {
			ops = shownOps(session.queue);
			rev++;
			if (session.reloads !== reloads) [reloads, selectedLeg] = [session.reloads, null];
			// The facts library (or the route) changed on disk: the shared records are read again.
			const d = session.doc?.deps ?? null;
			if (d !== deps) {
				if (deps !== null) void loadLibrary();
				deps = d;
			}
			if (usageStale && !ops.length) {
				usageStale = false;
				void loadLibrary();
			}
			if (!opened && session.doc) {
				const f = localFacts(session.doc, ops, scope) as Record<string, unknown> | undefined;
				opened = Object.fromEntries(Object.keys(FACTS.f).map((k) => [k, hasContent(f?.[k])]));
			}
		};
		sync();
		return session.subscribe(sync);
	});

	// The shared records: loaded with the tab, replaced by each write's answer; a stale write reloads them.
	let library = $state.raw<LibraryState | null>(null);
	let libraryError = $state<string | null>(null);
	// The stops of the preview's last good reading: a stop named by a string finds its record through its resolved place.
	let previewStops = $state.raw<unknown[]>([]);
	const libraryApi = libraryClient(
		(method, body) => api<LibraryState>(method, method === 'GET' ? '/api/facts/library' : '/api/facts/library/record', body),
		(state) => ([library, libraryError] = [state, null])
	);
	async function loadLibrary(): Promise<LibraryState | null> {
		try {
			// Overtaken by a newer answer: that one is the library now.
			return (await libraryApi.load()) ?? libraryApi.state();
		} catch (e) {
			libraryError = e instanceof Error ? e.message : String(e);
			return null;
		}
	}
	onMount(() => void loadLibrary());
	// A sent op that may change which record an entry takes: once the queue is empty (it is saved), the usage is read
	// again. Other saves don't, since each read costs the server a pass over every doc.
	let usageStale = false;
	function edited(op: FieldOp, debounce: boolean) {
		if (touchesRecord(op)) usageStale = true;
		session.edit(op, debounce);
	}
	const shared: SharedCtx = {
		state: () => library,
		stops: () => previewStops,
		reload: loadLibrary,
		put: libraryApi.put
	};

	// "Fill empty from English": the scope's own texts with English and no second language, each filled as a text edit
	// at its path (as typed), or a link's text, a point's or a spot's name as the whole value at its `commitPath`; each
	// marked as a DeepL draft until edited.
	const draftScope = $derived(`${refSearch(session.ref)}#facts:${scope}`);
	const scopeFacts = () => localFacts(session.doc, shownOps(session.queue), scope);
	function commitFill(r: FillResult<unknown>) {
		const now = scopeFacts();
		for (const id of r.applied) {
			// A link's label, a point's or a spot's name: the whole value, as its own field writes it.
			const whole = r.commitPaths[id];
			if (whole) {
				edited(editOp(scope, whole, at(r.state, whole)), true);
				continue;
			}
			const path = JSON.parse(id) as Path;
			const edit = textEdit(statedTexts(session.doc, shownOps(session.queue), scope, path), at(now, path), lang, r.filled[id]);
			edited(editOp(scope, path, edit), true);
		}
		drafts.add(draftScope, r.applied);
	}

	const ctx: FactsCtx = $derived({
		lang,
		scope,
		edit: (path, value, debounce) => edited(editOp(scope, path, value), debounce),
		send: edited,
		move: (path, list, from, to) => edited(moveOp(scope, path, list, from, to), false),
		stated: (path) => statedTexts(session.doc, shownOps(session.queue), scope, path),
		// Read with `rev`, so a files change (a bailout uploaded) redraws the fields that use it.
		doc: () => {
			void rev;
			return session.doc;
		},
		shared,
		draft: {
			has: (path) => drafts.has(draftScope, JSON.stringify(path)),
			clear: (path) => drafts.clear(draftScope, JSON.stringify(path))
		}
	});
</script>

<div class="facts-tab">
	<section class="facts" aria-label="Facts">
		<header>
			<div class="scope" role="group" aria-label="Edit the facts of">
				<button type="button" aria-pressed={scope === 'hike'} onclick={() => pickScope('hike')}>Hike defaults</button>
				<button type="button" aria-pressed={scope === 'post'} disabled={!hasPost} onclick={() => pickScope('post')}>This visit</button>
			</div>
			{#if loaded}
				<FillButton doc={draftScope} surface="facts" lang={lang === 'en' ? null : lang} gather={() => (lang === 'en' ? [] : gatherFacts(scopeFacts(), lang))} current={scopeFacts} commit={commitFill} blocked={conflictOf(session)} />
			{/if}
		</header>

		{#if libraryError}<p class="note">Shared records not loaded: {libraryError}</p>{/if}
		{#if !loaded}
			<p class="note">Loading…</p>
		{:else}
			{#each Object.entries(FACTS.f) as [key, spec] (key)}
				<details class="section" open={opened?.[key] ?? false}>
					<summary>{fieldLabel(key)}</summary>
					<div class="body">
						{#if key === 'legs'}
							<RouteList
								spec={spec as Extract<Spec, { t: 'list' }>}
								value={facts?.[key]}
								inherited={hikeFacts?.[key]}
								{ctx}
								selected={selectedLeg}
								onselect={(i) => (selectedLeg = i)}
							/>
						{:else if scope === 'hike' && POST_ONLY.includes(key)}
							<p class="note">Only a visit can set this.</p>
						{:else}
							<FactsField {spec} path={[key]} value={facts?.[key]} inherited={hikeFacts?.[key]} {ctx} bare />
						{/if}
					</div>
				</details>
			{/each}
			<NearDuplicates {session} {shared} pending={ops.length > 0} />
		{/if}
	</section>
	<FactsPreview {session} {scope} selected={selectedLeg} libraryVersion={library?.version ?? null} onfacts={(r) => (previewStops = (r.facts?.stops as unknown[] | undefined) ?? [])} />
</div>

<style>
	/* The preview beside the form, sharing the width (never under 18rem; the form keeps its own 48rem at most); on a phone
	   it is a sheet above the tab bar, with room left for its toggle. */
	.facts-tab {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 1fr);
		gap: 1rem;
		align-items: start;
	}
	@media (max-width: 719px) {
		.facts-tab {
			grid-template-columns: minmax(0, 1fr);
			padding-bottom: calc(var(--tab-bar-height) + 1px);
		}
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 48rem;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.scope {
		display: inline-flex;
	}
	.scope button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid #888;
		background: #fff;
	}
	.scope button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.scope button:last-child {
		border-left: none;
		border-radius: 0 4px 4px 0;
	}
	.scope button[aria-pressed='true'] {
		background: #1b5e20;
		border-color: #1b5e20;
		color: #fff;
	}
	.scope button:disabled {
		color: #999;
	}
	.section {
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	summary {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.body {
		padding: 0 0.75rem 0.75rem;
	}
	.note {
		margin: 0;
		color: #555;
		font-size: 0.9rem;
	}
</style>

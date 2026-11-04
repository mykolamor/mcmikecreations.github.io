<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { createStringsSave, fromText, rows, toText, type StringValue } from '../strings/rows';
	import type { Lang } from '$lib/i18n/languages';
	import FillButton from '../fill/FillButton.svelte';
	import { drafts } from '../fill/drafts.svelte';
	import { CONFLICT_MEANWHILE, gatherStrings, type FillResult } from '../fill/fill';

	// The site's label and tag table of one language beside the English one (`?strings=<lang>`), not a doc: typing saves
	// the key after a pause through the table's own save, on the version last read.
	let { lang }: { lang: string } = $props();
	const save = createStringsSave(untrack(() => lang));
	const LANG = untrack(() => lang).toUpperCase();

	let en = $state.raw<Record<string, StringValue>>({});
	/** Each key's textarea text, as typed. */
	let texts = $state<Record<string, string>>({});
	/** The rows' order, fixed at each load: a row filled while typing stays where it is. */
	let order = $state.raw<Map<string, number>>(new Map());
	let status = $state(save.status);
	let error = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let loaded = $state(false);
	let query = $state('');
	/** The keys the table lacked at the last load: "Missing only" shows these (a row typed into stays). */
	let missingAtLoad = $state.raw(new Set<string>());
	/** On by default when the table lacks keys. */
	let missingOnly = $state<boolean | null>(null);
	const DRAFTS = `strings:${untrack(() => lang)}`;

	async function load() {
		loadError = null;
		try {
			await save.load();
		} catch (e) {
			loadError = (e as Error).message;
			return;
		}
		en = save.en;
		texts = Object.fromEntries(Object.keys(save.en).map((key) => [key, toText(save.own[key])]));
		order = new Map(rows(save.en, save.own).map((r, i) => [r.key, i]));
		missingAtLoad = new Set(Object.keys(save.en).filter((key) => save.own[key] === undefined));
		missingOnly ??= missingAtLoad.size > 0;
		loaded = true;
	}

	/** The table as typed, for the rows' flags. */
	let typed = $derived(
		Object.fromEntries(
			Object.keys(en).flatMap((key) => {
				const value = fromText(texts[key] ?? '', Array.isArray(en[key]));
				return value === null ? [] : [[key, value]];
			})
		)
	);
	let shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return rows(en, typed)
			.filter((r) => !missingOnly || missingAtLoad.has(r.key))
			.filter((r) => !q || [r.key, toText(r.en), texts[r.key] ?? ''].some((s) => s.toLowerCase().includes(q)))
			.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
	});
	let missingCount = $derived(Object.keys(en).length - Object.keys(typed).length);

	function input(key: string, text: string) {
		texts[key] = text;
		drafts.clear(DRAFTS, key);
		save.set(key, fromText(text, Array.isArray(en[key])));
	}

	// "Fill empty from English": the keys the table lacks, as typed now; each filled one is typed in as the author would.
	function commitFill(r: FillResult<Record<string, string>>) {
		for (const key of r.applied) input(key, r.state[key]);
		drafts.add(DRAFTS, r.applied);
	}

	onMount(() => {
		const off = save.subscribe(() => {
			status = save.status;
			error = save.error;
		});
		void load();
		const beforeUnload = (e: BeforeUnloadEvent) => {
			if (Object.keys(save.pending()).length) e.preventDefault();
		};
		window.addEventListener('beforeunload', beforeUnload);
		return () => {
			off();
			window.removeEventListener('beforeunload', beforeUnload);
			void save.flush();
		};
	});

	const lines = (text: string) => Math.min(10, text.split('\n').length + 1);
</script>

<section class="strings">
	<div class="bar">
		<h2>Label tables · {LANG}</h2>
		<input type="search" placeholder="Filter keys and text" aria-label="Filter strings" bind:value={query} />
		{#if loaded}
			<span class="count">{missingCount} missing</span>
			<button type="button" class="toggle" onclick={() => (missingOnly = !missingOnly)}>{missingOnly ? 'Show all' : 'Missing only'}</button>
			<FillButton
				doc={DRAFTS}
				surface="strings"
				lang={lang as Lang}
				gather={() => gatherStrings(rows(en, typed))}
				current={() => ({ ...texts })}
				commit={commitFill}
				disabled={status === 'conflict'}
				blocked={() => (save.status === 'conflict' ? CONFLICT_MEANWHILE : null)} />
		{/if}
		<span class="status" aria-live="polite">{status === 'saving' ? 'Saving…' : status === 'error' ? `Save failed: ${error ?? 'unknown error'}` : ''}</span>
	</div>
	{#if status === 'conflict'}
		<div class="conflict" role="alert">
			Changed on disk —
			<button type="button" onclick={load}>Reload</button>
			<span>(your unsaved edits are dropped)</span>
		</div>
	{/if}
	{#if loadError}
		<p class="error" role="alert">{loadError} <button type="button" onclick={load}>Retry</button></p>
	{:else if !loaded}
		<p>Loading…</p>
	{/if}
	{#if loaded}
		<div class="head" aria-hidden="true"><span>English</span><span>{LANG}</span></div>
		<ul>
			{#each shown as r (r.key)}
				<li>
					<div class="key">
						<code>{r.key}</code>
						{#if r.missing}<span class="badge">Missing: the site shows English</span>{/if}
						{#if Array.isArray(r.en)}<span class="badge">Paragraphs: a blank line between them</span>{/if}
					</div>
					<div class="pair">
						<div class="en">{toText(r.en)}</div>
						<div class="own">
							<textarea
								aria-label={`${r.key} (${LANG})`}
								class:deepl-draft={drafts.has(DRAFTS, r.key)}
								rows={lines(texts[r.key] ?? toText(r.en))}
								value={texts[r.key] ?? ''}
								oninput={(e) => input(r.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
							{#if drafts.has(DRAFTS, r.key)}<p class="deepl-draft-label">DeepL draft</p>{/if}
							{#if r.mismatch}
								<p class="warn" role="status">Placeholders differ from the English: {r.placeholders.length ? r.placeholders.map((p) => `{${p}}`).join(' ') : 'it has none'}</p>
							{/if}
						</div>
					</div>
				</li>
			{:else}
				<li>{missingOnly ? 'No missing strings match.' : 'No strings match.'}</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	h2 {
		margin: 0;
	}
	.bar input {
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	.count,
	.status {
		color: #555;
	}
	.conflict,
	.error {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		border: 2px solid #111;
		padding: 0.4rem 0.6rem;
		margin: 0.75rem 0 0;
	}
	.head,
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
	}
	.head {
		margin-top: 1rem;
		font-weight: 700;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
	}
	li {
		border-top: 1px solid #ccc;
		padding: 0.6rem 0;
	}
	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.3rem;
	}
	code {
		overflow-wrap: anywhere;
	}
	.badge {
		border: 1px solid #111;
		border-radius: 3px;
		padding: 0 0.3rem;
		font-size: 0.8rem;
	}
	.en {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	textarea {
		font: inherit;
		font-size: 0.95rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		resize: vertical;
	}
	.toggle {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #fff;
	}
	.warn {
		margin: 0.3rem 0 0;
		border-left: 3px solid #111;
		padding-left: 0.5rem;
		font-size: 0.85rem;
	}
	@media (max-width: 719px) {
		.head {
			display: none;
		}
		/* On a phone each English string sits above its translation. */
		.pair {
			grid-template-columns: 1fr;
			gap: 0.4rem;
		}
	}
</style>

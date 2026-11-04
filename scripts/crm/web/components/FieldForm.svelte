<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api } from '../api';
	import { FIELDS, PLACE_FIELDS, detailsFields, translationFields } from '../../shared/fields';
	import type { Lang } from '$lib/i18n/languages';
	import type { MirrorRow } from '../../shared/mirrors';
	import type { createDocSession } from '../doc-session';
	import { isValidDate } from '../date-utils';
	import ChipInput from './ChipInput.svelte';
	import DateInput from './DateInput.svelte';
	import { secondLang } from '../lang.svelte';
	import { refSearch } from '../doc-session';
	import FillButton from '../fill/FillButton.svelte';
	import { drafts } from '../fill/drafts.svelte';
	import { conflictOf, gatherRoute, type FillResult } from '../fill/fill';
	import { languageName, type Translations } from '../write/translation-session';

	let {
		session,
		translations = null,
		openTab
	}: {
		session: ReturnType<typeof createDocSession>;
		/** The doc's translations: its texts in the second language show read-only under the English, edited in Write. */
		translations?: Translations | null;
		openTab?: (id: string, hint?: string | null) => void;
	} = $props();

	const asText = (v: unknown) => (typeof v === 'string' ? v : '');
	const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
	const kept = (rows: MirrorRow[]) =>
		rows
			.filter((r) => r.url.trim())
			.map((r) => `${r.key ?? ''}\0${r.title}\0${r.url}`)
			.join('\n');

	let loaded = $state(false);
	let values = $state<Record<string, unknown>>({});
	let texts = $state<Record<string, Record<string, string>>>({});
	let mirrors = $state<MirrorRow[]>([]);
	let suggest = $state<Record<string, string[]>>({});
	let lang = $derived(secondLang());
	let hasPost = $derived(session.doc?.date != null);

	// ---- the translation's texts (a post's or place doc's `<source>.<lang>.md`): shown here, edited in Write's DE view
	/** The English field each translation field translates. */
	const TR_OF: Record<string, string> = { 'post.title': 'tr.title', 'post.description': 'tr.description', 'place.title': 'tr.title', 'place.description': 'tr.description', 'place.aliases': 'tr.aliases' };
	/** The translation as read: null while loading (or without one to show), `exists: false` when not made yet. */
	let trDoc = $state.raw<{ exists: boolean; fields: Record<string, unknown> } | null>(null);
	$effect(() => {
		const l = lang;
		const kind = session.ref.kind;
		if (!l || !translations || (kind !== 'post' && kind !== 'place')) {
			trDoc = null;
			return;
		}
		// The session Write opens too: an edit made there shows here, and both share one load.
		const s = untrack(() => translations.open(l));
		const update = () => (trDoc = s.doc ? { exists: s.doc.exists !== false, fields: s.doc.fields } : null);
		update();
		return s.subscribe(update);
	});
	const trText = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : asText(v));
	// A place doc has its own front matter fields and no mirrors; a translation has its texts only.
	let fields = $derived(
		session.ref.kind === 'translation' ? translationFields(session.ref.source.kind) : session.ref.kind === 'place' ? PLACE_FIELDS : detailsFields()
	);
	/** The first field with a translation: a translation not made yet is offered there, once. */
	let firstTr = $derived(fields.find((f) => TR_OF[f.id])?.id ?? null);

	// The draft follows the server doc only while nothing of mine is unsaved, so typing is never clobbered; a text queued
	// from outside the form (Fill) shows meanwhile.
	function sync() {
		const d = session.doc;
		if (!d) return;
		if (loaded && (session.queue.pending().length > 0 || session.queue.status !== 'saved')) return adoptQueued();
		values = { ...d.fields };
		texts = structuredClone($state.snapshot(d.texts ?? {}));
		const server = (d.mirrors ?? []) as MirrorRow[];
		if (!loaded) mirrors = server.map((r) => ({ ...r }));
		else if (kept(server) !== kept(mirrors)) {
			// Adopt the server's rows with their keys (indices may have shifted); keep my blank custom rows.
			const mine = mirrors.filter((r) => !r.url.trim() && r.key === undefined && !server.some((x) => x.title === r.title));
			mirrors = [...server.map((r) => ({ ...r })), ...mine];
		}
		loaded = true;
	}

	function adoptQueued() {
		for (const op of session.queue.pending()) {
			if ('kind' in op || typeof op.value !== 'string') continue;
			if (op.lang) {
				if ((texts[op.field]?.[op.lang] ?? '') !== op.value) texts[op.field] = { ...texts[op.field], [op.lang]: op.value };
			} else if (values[op.field] !== op.value) values[op.field] = op.value;
		}
	}

	onMount(() => {
		sync();
		const off = session.subscribe(sync);
		for (const kind of new Set(fields.map((f) => f.suggest).filter(Boolean) as string[])) {
			api<{ items: string[] }>('GET', `/api/suggest?kind=${kind}`)
				.then((r) => (suggest[kind] = r.items))
				.catch(() => {});
		}
		return off;
	});

	// Post fields have no file to land in on a hike-only view: never queue them (the server would 400).
	const editable = (id: string) => session.doc?.date != null || !FIELDS.find((f) => f.id === id && f.file === 'post');
	function setText(id: string, v: string) {
		values[id] = v;
		drafts.clear(scope, id);
		if (editable(id)) session.edit({ field: id, value: v }, true);
	}
	// The route words' other language: its own op, so the English text and the other languages stay as they are.
	function setLangText(id: string, lang: string, v: string) {
		texts[id] = { ...texts[id], [lang]: v };
		drafts.clear(scope, `${id}:${lang}`);
		session.edit({ field: id, lang: lang as Lang, value: v }, true);
	}
	function setChips(id: string, v: string[]) {
		values[id] = v;
		if (editable(id)) session.edit({ field: id, value: v }, false);
	}
	// ---- DeepL drafts: a field Fill filled is marked until it is edited
	const scope = $derived(refSearch(session.ref));
	const isDraft = (id: string) => drafts.has(scope, id);

	/** The route words (the sidecar's translated fields) as typed: English and the other languages. */
	function routeTexts(): Record<string, Record<string, string>> {
		return Object.fromEntries(fields.filter((f) => f.translated).map((f) => [f.id, { ...$state.snapshot(texts[f.id]), en: asText(values[f.id]) }]));
	}
	function commitRoute(r: FillResult<Record<string, Record<string, string>>>) {
		if (!lang) return;
		for (const id of r.applied) setLangText(id, lang, r.state[id][lang]);
		drafts.add(
			scope,
			r.applied.map((id) => `${id}:${lang}`)
		);
	}

	function sendMirrors(debounce: boolean) {
		if (!hasPost) return;
		session.edit({ kind: 'mirrors', rows: mirrors.map((r) => ({ ...r })) }, debounce);
	}
</script>

{#snippet trRow(f: (typeof fields)[number])}
	{@const trId = TR_OF[f.id]}
	{#if trId && lang && trDoc}
		{#if trDoc.exists}
			{@const v = trText(trDoc.fields[trId])}
			<div class="tr-row">
				<span class="tr-label">{f.label} ({lang.toUpperCase()}) <button type="button" class="link" onclick={() => openTab?.('write', 'tr')}>Edit in Write</button></span>
				{#if f.kind === 'textarea'}
					<textarea rows="3" readonly aria-label={`${f.label} (${lang.toUpperCase()})`} placeholder="Not translated" value={v}></textarea>
				{:else}
					<input type="text" readonly aria-label={`${f.label} (${lang.toUpperCase()})`} placeholder="Not translated" value={v} />
				{/if}
			</div>
		{:else if f.id === firstTr}
			<p class="tr-missing">
				No {languageName(lang)} translation yet. <button type="button" class="link" onclick={() => openTab?.('write', 'tr')}>Translate in Write</button>
			</p>
		{/if}
	{/if}
{/snippet}

{#if !loaded}
	<p>Loading…</p>
{:else}
	<form class="form" onsubmit={(e) => e.preventDefault()}>
		{#if fields.some((f) => f.translated)}
			<FillButton doc={scope} surface="details" {lang} gather={() => (lang ? gatherRoute(routeTexts(), lang) : [])} current={routeTexts} commit={commitRoute} blocked={conflictOf(session)} />
		{/if}
		{#each fields as f (f.id)}
			{@const off = f.file === 'post' && !hasPost}
			{#if f.kind === 'text'}
				<label>
					<span>{f.label}{f.required ? ' *' : ''}</span>
					<input type="text" class:deepl-draft={isDraft(f.id)} disabled={off} value={asText(values[f.id])} oninput={(e) => setText(f.id, e.currentTarget.value)} />
					{#if isDraft(f.id)}<small class="deepl-draft-label">DeepL draft</small>{/if}
				</label>
				{#if f.translated && lang}
					<label>
						<span>{f.label} ({lang.toUpperCase()})</span>
						<input type="text" class:deepl-draft={isDraft(`${f.id}:${lang}`)} value={texts[f.id]?.[lang] ?? ''} oninput={(e) => setLangText(f.id, lang, e.currentTarget.value)} />
						{#if isDraft(`${f.id}:${lang}`)}<small class="deepl-draft-label">DeepL draft</small>{/if}
					</label>
				{/if}
				{@render trRow(f)}
			{:else if f.kind === 'textarea'}
				<label>
					<span>{f.label}{f.required ? ' *' : ''}</span>
					<textarea rows="3" class:deepl-draft={isDraft(f.id)} disabled={off} value={asText(values[f.id])} oninput={(e) => setText(f.id, e.currentTarget.value)}></textarea>
					{#if isDraft(f.id)}<small class="deepl-draft-label">DeepL draft</small>{/if}
				</label>
				{#if f.translated && lang}
					<label>
						<span>{f.label} ({lang.toUpperCase()})</span>
						<textarea rows="3" class:deepl-draft={isDraft(`${f.id}:${lang}`)} value={texts[f.id]?.[lang] ?? ''} oninput={(e) => setLangText(f.id, lang, e.currentTarget.value)}></textarea>
						{#if isDraft(`${f.id}:${lang}`)}<small class="deepl-draft-label">DeepL draft</small>{/if}
					</label>
				{/if}
				{@render trRow(f)}
			{:else if f.kind === 'date'}
				<DateInput label={f.label} disabled={off} value={asText(values[f.id])} onchange={(v) => (v === '' || isValidDate(v)) && setText(f.id, v)} />
			{:else}
				<ChipInput
					label={f.label}
					values={asList(values[f.id])}
					suggestions={f.suggest ? (suggest[f.suggest] ?? []) : []}
					disabled={off}
					onchange={(v) => setChips(f.id, v)}
				/>
				{@render trRow(f)}
			{/if}
		{/each}

		{#if hasPost}
			<fieldset class="mirrors">
				<legend>Sources (mirror links)</legend>
				{#each mirrors as row, i}
					<div class="mirror">
						<input type="text" aria-label="Source name" placeholder="Name" bind:value={row.title} oninput={() => sendMirrors(true)} />
						<input type="url" aria-label={`${row.title || 'Source'} URL`} placeholder="https://…" bind:value={row.url} oninput={() => sendMirrors(true)} />
						<button
							type="button"
							class="x"
							aria-label={`Remove ${row.title || 'source'}`}
							onclick={() => {
								mirrors.splice(i, 1);
								sendMirrors(false);
							}}>×</button
						>
					</div>
				{/each}
				<button type="button" onclick={() => mirrors.push({ title: '', url: '' })}>+ Add source</button>
			</fieldset>
		{/if}
	</form>
{/if}

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	input,
	textarea {
		font: inherit;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		min-width: 0;
	}
	textarea {
		resize: vertical;
	}
	/* The translation's texts: read-only here, edited in Write. */
	.tr-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	.tr-row input,
	.tr-row textarea {
		background: color-mix(in srgb, currentColor 6%, transparent);
		border-style: dashed;
	}
	.tr-missing {
		margin: 0;
		font-size: 0.85rem;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		min-height: 0;
		font: inherit;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.mirrors {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		margin: 0;
	}
	.mirror {
		display: grid;
		grid-template-columns: 7rem 1fr 2.75rem;
		gap: 0.4rem;
	}
	.x {
		padding: 0;
		font-size: 1.3rem;
	}
	@media (max-width: 719px) {
		.mirror {
			grid-template-columns: 1fr 2.75rem;
		}
		.mirror input:first-child {
			grid-column: 1 / -1;
		}
		.mirror input:nth-child(2) {
			grid-column: 1;
		}
	}
</style>

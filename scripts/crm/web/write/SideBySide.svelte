<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { createDocSession } from '../doc-session';
	import { blocks, blockTyping, currentBody, pairBlocks, type Block, type Pair } from './pairs';
	import { mediaChips } from './media-chips';
	import { mediaLines } from '../../shared/md-lines';
	import { languageName } from './translation-session';
	import { avifVariantHref } from '$lib/renderers/responsive-image';
	import type { Lang } from '$lib/i18n/languages';
	import { refSearch } from '../doc-session';
	import { drafts } from '../fill/drafts.svelte';
	import { blockDraftKey } from '../fill/fill';

	type Session = ReturnType<typeof createDocSession>;
	type Side = 'en' | 'tr';
	let { en, tr, lang, ownFolder }: { en: Session; tr: Session; lang: Lang; ownFolder: string } = $props();

	const POSTERS = '/images/projects/data-viz/hikes/videos/';

	let pairs = $state.raw<Pair[]>([]);
	/** Bumped when the rows are paired again after "Reload (discard my unsaved)": the textareas are made anew with the doc's text. */
	let generation = $state(0);
	/** Translation blocks (by text) whose English partner was edited in this view: kept in memory only. */
	let stale = $state.raw(new Set<string>());
	/**
	 * The side being typed in, its block followed through its own edits (`blockTyping`). The rows stay as they are
	 * meanwhile (a blank line typed would split the row under the cursor), a freshness reload included: the next input
	 * finds its block again by its text, or conflicts. They are paired again once the focus has left the textareas.
	 */
	let editing: { side: Side; pair: Pair; typing: ReturnType<typeof blockTyping> } | null = null;
	// The parent keys this view by the translation's session, so neither session changes while it lives.
	let discards = untrack(() => ({ en: en.discards, tr: tr.discards }));
	let overwrites = untrack(() => ({ en: en.overwrites, tr: tr.overwrites }));

	/** The translation's DeepL drafts (blocks Fill put in, by text) are marked until edited. */
	const draftScope = untrack(() => refSearch(tr.ref));
	const isDraft = (side: Side, block: Block) => side === 'tr' && drafts.has(draftScope, blockDraftKey(block.text));

	const SIDES: Side[] = ['en', 'tr'];
	const sessionOf = (side: Side) => (side === 'en' ? en : tr);
	/**
	 * A side whose session is in conflict is read-only until the banner is answered: what is typed then can't be saved
	 * (its block wasn't found), and Overwrite or Reload would replace it with the file's text.
	 */
	let locked = $state({ en: false, tr: false });

	function refresh() {
		locked = { en: en.queue.status === 'conflict', tr: tr.queue.status === 'conflict' };
		// "Reload (discard my unsaved)" drops what is being typed too: the rows show the doc again.
		if (en.discards !== discards.en || tr.discards !== discards.tr) {
			discards = { en: en.discards, tr: tr.discards };
			editing = null;
			generation++;
		}
		// Overwrite drops the edit held by its old text (the conflict was that it couldn't be found): the rows are
		// paired again from the doc, and the next keystroke starts over from its row instead of conflicting again.
		if (en.overwrites !== overwrites.en || tr.overwrites !== overwrites.tr) {
			overwrites = { en: en.overwrites, tr: tr.overwrites };
			editing = null;
		}
		if (editing) return;
		pairs = pairBlocks(blocks(currentBody(en) ?? ''), blocks(currentBody(tr) ?? ''));
	}

	onMount(() => {
		refresh();
		const offs = [en.subscribe(refresh), tr.subscribe(refresh)];
		return () => offs.forEach((off) => off());
	});

	/** The side's block nearest before row `i`: where a block typed into that row's empty side goes. */
	function blockBefore(side: Side, i: number): Block | null {
		for (let k = i - 1; k >= 0; k--) {
			const b = pairs[k][side];
			if (b) return b;
		}
		return null;
	}

	function onfocus(side: Side, i: number) {
		const pair = pairs[i];
		editing = { side, pair, typing: blockTyping(sessionOf(side), pair[side] ?? null, blockBefore(side, i)) };
	}

	// Paired again after the focus moved on, not before: a tap into another textarea finds the rows it saw.
	function onblur() {
		editing = null;
		setTimeout(refresh);
	}

	function oninput(side: Side, i: number, e: Event) {
		// The textarea has the focus but its edit was dropped (rows paired again): it starts over from its row.
		if (!editing || editing.side !== side || editing.pair !== pairs[i]) onfocus(side, i);
		const ed = editing!;
		if (side === 'tr' && ed.pair.tr) drafts.clear(draftScope, blockDraftKey(ed.pair.tr.text));
		if (ed.typing.input((e.currentTarget as HTMLTextAreaElement).value) !== 'queued') return;
		const partner = ed.pair.tr;
		if (side === 'en' && partner && !stale.has(partner.text)) stale = new Set(stale).add(partner.text);
		if (side === 'tr' && partner && stale.has(partner.text)) {
			const next = new Set(stale);
			next.delete(partner.text);
			stale = next;
		}
	}

	/** A photo's thumbnail falls back to its original, a poster to its JPEG. */
	function fallback(e: Event, src: string) {
		const img = e.currentTarget as HTMLImageElement;
		img.onerror = null;
		img.src = src;
	}

	const rows = (text: string) => Math.max(2, text.split('\n').length);
</script>

<div class="sbs" role="table" aria-label="Side by side">
	<div class="head" role="row">
		<span role="columnheader">English</span>
		<span role="columnheader">{languageName(lang)}</span>
	</div>
	{#key generation}
		{#each pairs as pair, i (i)}
			<div class="row" role="row">
				{#each SIDES as side (side)}
					{@const block = pair[side]}
					<div class="cell" role="cell">
						<span class="lang">{side === 'en' ? 'EN' : lang.toUpperCase()}</span>
						{#if block?.kind === 'media'}
							<div class="media" title={block.text}>
								{#each mediaChips(block.text, ownFolder) as c (c.at)}
									<span class="chip chip-{c.kind}">
										{#if c.kind === 'photo'}
											<img src={avifVariantHref(c.href, 640)} alt="" loading="lazy" onerror={(e) => fallback(e, c.href)} />{c.key}
										{:else if c.kind === 'video'}
											🎞 {c.label}
										{:else if c.kind === 'youtube'}
											{#if c.youtube}<img src="{POSTERS}{c.youtube}-640.avif" alt="" loading="lazy" onerror={(e) => fallback(e, `${POSTERS}${c.youtube}.jpg`)} />{/if}▶ YouTube
										{:else}
											missing
										{/if}
									</span>
								{/each}
							</div>
							{#if side === 'en'}
								{#each mediaLines(block.text).filter((m) => m.caption.trim()) as m (m.from)}
									<p class="caption">{m.caption}</p>
								{/each}
							{/if}
						{/if}
						{#if block && (block.kind !== 'media' || side === 'tr')}
							<textarea
								aria-label={side === 'en' ? 'English' : languageName(lang)}
								class:deepl-draft={isDraft(side, block)}
								rows={rows(block.text)}
								value={block.text}
								readonly={locked[side]}
								onfocus={() => onfocus(side, i)}
								{onblur}
								oninput={(e) => oninput(side, i, e)}
							></textarea>
							{#if isDraft(side, block)}
								<p class="deepl-draft-label">DeepL draft</p>
							{/if}
							{#if side === 'tr' && stale.has(block.text)}
								<p class="hint" role="status">{languageName(lang)} may need the same change</p>
							{/if}
						{:else if !block && side === 'tr'}
							<textarea
								aria-label={languageName(lang)}
								rows="2"
								placeholder="Add translation here"
								value=""
								readonly={locked[side]}
								onfocus={() => onfocus(side, i)}
								{onblur}
								oninput={(e) => oninput(side, i, e)}
							></textarea>
						{:else if !block}
							<p class="empty">English has nothing here</p>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">No text yet.</p>
		{/each}
	{/key}
</div>

<style>
	.sbs {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 96rem;
	}
	.head,
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.5rem;
	}
	.head {
		font-weight: 700;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.lang {
		display: none;
		font-size: 0.75rem;
		color: #444;
	}
	.caption {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
		color: #444;
		white-space: pre-wrap;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: 2.75rem;
		field-sizing: content;
		resize: vertical;
		padding: 0.4rem 0.6rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #fff;
		color: #111;
		font: 1rem/1.5 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
	}
	textarea:focus {
		outline: 2px solid #111;
		outline-offset: 1px;
	}
	.media {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		min-height: 2.75rem;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 2px 0.4rem 2px 2px;
		border: 1px solid #bbb;
		border-radius: 4px;
		background: #f4f4f4;
		color: #333;
		font: 0.8rem system-ui, sans-serif;
	}
	.chip img {
		height: 2.5rem;
		width: auto;
		max-width: 4.5rem;
		object-fit: cover;
		border-radius: 3px;
		background: #ddd;
	}
	.chip-missing {
		border-color: #b00;
		color: #b00;
	}
	.empty {
		margin: 0;
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		color: #555;
		font-style: italic;
	}
	.hint {
		margin: 0;
		padding: 0.2rem 0.5rem;
		border-left: 3px solid #b26a00;
		background: #fff4e0;
		color: #111;
		font-size: 0.85rem;
	}
	/* A phone: each row's English above its translation. */
	@media (max-width: 600px) {
		.head {
			display: none;
		}
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.25rem;
			padding-bottom: 0.5rem;
			border-bottom: 1px solid #ddd;
		}
		.lang {
			display: block;
		}
	}
</style>

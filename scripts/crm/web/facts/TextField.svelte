<script lang="ts">
	import type { Lang } from '$lib/hikes/facts-schema';
	import { mergeText, textEdit, textParts } from './form-model';

	// A text: English and the session language side by side (stacked on a phone). Each edit states every language (see
	// textEdit), an empty one clearing that language; one the server would refuse (no English beside a translation) is never queued.
	// `inherited`: this visit's text merges per language over the hike's, so a language the visit leaves out shows the hike's.
	// `lang` English (a site with no other language): English alone.
	// `draft`: the session language's text is a DeepL draft (Fill), marked until the field is edited (`ontouch`).
	let {
		label,
		value,
		inherited = undefined,
		stated = () => [],
		lang,
		onedit,
		draft = false,
		ontouch = () => {}
	}: {
		label: string;
		value: unknown;
		inherited?: unknown;
		stated?: () => unknown[];
		lang: Lang;
		onedit: (edit: Record<string, string>, debounce: boolean) => void;
		draft?: boolean;
		ontouch?: () => void;
	} = $props();

	const parts = $derived(textParts(value));
	const hike = $derived(textParts(inherited));
	let refused = $state<string | null>(null);

	function input(which: 'en' | Lang, e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		const edit = textEdit(stated(), value, which, el.value);
		const r = mergeText(value, edit);
		if ('error' in r) {
			// Keep what was there: the field's value didn't change, so the textarea must be put back by hand.
			el.value = parts[which] ?? '';
			refused = r.error;
			return;
		}
		refused = null;
		// Only an edit of the draft's own language: typing the English leaves the translation a draft.
		if (which === lang) ontouch();
		onedit(edit, true);
	}
</script>

<div class="text">
	<span class="name">{label}</span>
	<div class="pair" class:single={lang === 'en'}>
		<label>
			<span>EN</span>
			<textarea rows="2" value={parts.en ?? ''} placeholder={hike.en ?? ''} oninput={(e) => input('en', e)}></textarea>
		</label>
		{#if lang !== 'en'}
			<label>
				<span>{lang.toUpperCase()}{draft ? ' · DeepL draft' : ''}</span>
				<textarea rows="2" class:deepl-draft={draft} value={parts[lang] ?? ''} placeholder={hike[lang] ?? ''} oninput={(e) => input(lang, e)}></textarea>
			</label>
		{/if}
	</div>
	{#if refused}<p class="refused" role="alert">{refused}</p>{/if}
</div>

<style>
	.text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	.name:empty {
		display: none;
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.4rem;
	}
	.pair.single {
		grid-template-columns: minmax(0, 1fr);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	label span {
		color: #555;
		font-size: 0.75rem;
	}
	textarea {
		font: inherit;
		font-size: 0.95rem;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		resize: vertical;
		min-width: 0;
	}
	.refused {
		margin: 0;
		color: #b00020;
	}
	@media (max-width: 719px) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>

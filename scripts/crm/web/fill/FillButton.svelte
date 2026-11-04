<script lang="ts" module>
	import { api } from '../api';

	type Status = { configured: boolean; targets: string[] };
	let status: Promise<Status> | null = null;
	/** Whether DeepL has a key, read once per page (adding one needs a reload of the page, not of the server). */
	const deeplStatus = () => (status ??= api<Status>('GET', '/api/deepl/status').catch(() => ((status = null), { configured: true, targets: [] })));
</script>

<script lang="ts" generics="S">
	import { onMount } from 'svelte';
	import type { Lang } from '$lib/i18n/languages';
	import { ApiClientError } from '../api';
	import { NO_KEY, deeplTarget } from '../../shared/deepl-langs';
	import { runFill, type FillItem, type FillResult } from './fill';
	import { noticeKey, readRefused, writeRefused } from './refused-notices';

	// "Fill empty from English": gathers the surface's empty texts when pressed, has DeepL translate them and hands what
	// could be applied (to the surface as it is when the answer arrives) to `commit`, which makes the surface's own edits.
	// Hidden for a language DeepL has no code for; without a key, disabled with the explanation. `blocked` names what keeps
	// an answer from being applied (a conflict raised while it was on its way), asked when it arrives, as `disabled` is.
	// The texts DeepL's answer couldn't be used for stay listed, for this `doc` and `surface`, until dismissed or filled again.
	let {
		doc,
		surface,
		lang,
		gather,
		current,
		commit,
		disabled = false,
		blocked = () => null
	}: {
		doc: string;
		surface: string;
		lang: Lang | null;
		gather: () => FillItem<S>[];
		current: () => S;
		commit: (r: FillResult<S>) => void;
		disabled?: boolean;
		blocked?: () => string | null;
	} = $props();

	let configured = $state(true);
	/** The number of texts on their way, while working. */
	let working = $state<number | null>(null);
	let error = $state<string | null>(null);
	let summary = $state<string | null>(null);
	let refused = $state.raw<FillResult<S>['refused']>([]);

	const key = $derived(lang ? noticeKey(doc, lang, surface) : null);
	$effect(() => {
		refused = key ? readRefused(localStorage, key) : [];
	});
	function setRefused(list: FillResult<S>['refused']) {
		refused = list;
		if (key) writeRefused(localStorage, key, list);
	}

	onMount(() => {
		void deeplStatus().then((s) => (configured = s.configured));
	});

	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

	async function fill() {
		if (!lang || working !== null) return;
		[error, summary] = [null, null];
		setRefused([]);
		const items = gather();
		if (!items.length) return void (summary = 'Nothing empty to fill');
		working = items.length;
		const labels = new Map(items.map((i) => [i.id, i.label]));
		try {
			const r = await runFill(lang, items, current, api, () => blocked() ?? (disabled ? 'Busy meanwhile (an upload or a conflict)' : null));
			try {
				commit(r);
			} catch (e) {
				// Some of its edits may have been made: say which it was making.
				error = `Filling stopped part way (${e instanceof Error ? e.message : String(e)}); it was filling: ${r.applied.map((id) => labels.get(id) ?? id).join(', ')}`;
				return;
			}
			setRefused(r.refused);
			summary = [
				r.applied.length ? `Filled ${plural(r.applied.length, 'text')} as DeepL drafts` : 'Nothing filled',
				r.skipped.length ? `skipped ${r.skipped.length}: filled meanwhile or its English changed` : ''
			]
				.filter(Boolean)
				.join(' · ');
		} catch (e) {
			const body = e instanceof ApiClientError ? (e.body as { error?: string; message?: string } | null) : null;
			if (body?.error === 'no-key') configured = false;
			error = `${body?.message ?? (e instanceof Error ? e.message : String(e))}. Nothing was filled.`;
		} finally {
			working = null;
		}
	}
</script>

{#if lang && deeplTarget(lang)}
	<div class="fill">
		<button type="button" disabled={!configured || working !== null || disabled} onclick={fill}>
			{working !== null ? `Filling ${working}…` : 'Fill empty from English'}
		</button>
		{#if !configured}<span class="note">{NO_KEY}</span>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if summary}<span class="note" role="status">{summary}</span>{/if}
		{#if refused.length}
			<div class="refused" role="alert">
				<div class="refused-head">
					<strong>{plural(refused.length, 'text')} not filled: still missing from this translation</strong>
					<button type="button" class="dismiss" onclick={() => setRefused([])}>Dismiss</button>
				</div>
				<ul>
					{#each refused as r (r.id)}<li>{r.label} <span class="reason">({r.reason})</span></li>{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<style>
	.fill {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid #888;
		border-radius: 4px;
		background: #fff;
		color: #111;
	}
	button:disabled {
		color: #666;
	}
	.note {
		color: #444;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.error,
	.refused {
		flex-basis: 100%;
		margin: 0;
		padding: 0.3rem 0.5rem;
		border-left: 3px solid #b00;
		font-size: 0.85rem;
	}
	.refused {
		border-left-color: #b26a00;
	}
	.refused ul {
		margin: 0.2rem 0 0;
		padding-left: 1.2rem;
	}
	.refused-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
	}
	.reason {
		color: #444;
	}
</style>

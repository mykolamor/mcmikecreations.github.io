<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { getTabs, leaveQuestion } from './registry';
	import { createDocSession, refFromSearch, refSearch } from './doc-session';
	import type { DocRef } from '../server/doc-ref';
	import OpenScreen from './tabs/OpenScreen.svelte';
	import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';
	import { secondLang, setSecondLang } from './lang.svelte';
	import { createGapWatch, createPinsWatch } from './gap-watch';
	import { tabHasGap, type Gaps } from '../shared/translation-gaps';
	import { createTranslations } from './write/translation-session';

	type Session = ReturnType<typeof createDocSession>;

	// `?slug=&date=` is the open hike (post), `?place=` a place doc; picking or creating one navigates there so a reload reopens it.
	// `?strings=<lang>` is a language's label and tag table, not a doc: no session, its tab saves by itself.
	const stringsLang = new URLSearchParams(location.search).get('strings');
	// Opening a table makes its language the second language, so the header and the page agree (one the site
	// doesn't translate into is ignored).
	if (stringsLang) setSecondLang(stringsLang as Lang);
	const ref = stringsLang ? null : refFromSearch(new URLSearchParams(location.search));
	const session = ref ? createDocSession(ref) : null;
	const openDoc = (r: DocRef) => (location.search = refSearch(r));
	const closeDoc = () => (location.search = '');
	// A post's or place doc's translations: each a session of its own, opened by the Write tab, closed with the doc.
	const translations = ref && ref.kind !== 'hike' ? createTranslations(ref) : null;
	/** Bumped when the Write tab opens a translation. */
	let opened = $state(0);
	/** The second language's translation once opened: its status and conflicts share the banner, prefixed. */
	let trSession = $derived.by(() => {
		void opened;
		const lang = secondLang();
		return translations && lang ? translations.get(lang) : null;
	});
	let trPrefix = $derived(`${secondLang()?.toUpperCase()}: `);
	/** What the doc lacks per language: the dots on the tabs. */
	let gaps = $state.raw<Gaps>({});
	/** A photo of the doc has a pin: the dot on the Photos tab. */
	let hasPins = $state(false);
	/** Every open session: the English doc's and its translations'. */
	const allSessions = (): Session[] => (session ? [session, ...(translations?.all() ?? [])] : []);

	// The item kind picks the tabs: a post and a hike-only view are both `hike`.
	const kind = stringsLang ? 'strings' : ref?.kind === 'place' ? 'place' : 'hike';
	let tabs = $derived(getTabs(kind));
	/** The tab a Reload left from (`sessionStorage`, this browser tab only), taken once. */
	const RELOAD_TAB_KEY = 'crm.reloadTab';
	function takeReloadTab(): string | null {
		try {
			const id = sessionStorage.getItem(RELOAD_TAB_KEY);
			sessionStorage.removeItem(RELOAD_TAB_KEY);
			return id;
		} catch {
			return null;
		}
	}
	let activeId = $state(takeReloadTab() ?? 'details');
	let active = $derived(tabs.find((t) => t.id === activeId) ?? tabs[0]);
	/** What the tab was opened for, read once when it mounts (Write: `'tr'` shows the translation); none from the tab bar. */
	let tabHint = $state<string | null>(null);

	/** Switches tabs once the shown tab agrees to be left (a running upload would be cancelled: the author is asked). */
	function pick(id: string, hint: string | null = null) {
		if (id === active?.id) return;
		const q = leaveQuestion();
		if (q !== null && !confirm(q)) return;
		tabHint = hint;
		activeId = id;
	}
	let tick = $state(Date.now());
	let status = $state(session?.queue.status ?? 'saved');
	let lastSavedAt = $state<number | null>(null);
	let errorMsg = $state<string | null>(null);
	let notice = $state<string | null>(null);
	// The Write editor's unsaved text, offered by the conflict banner.
	let unsavedBody = $state(false);
	// Facts edits address list entries by index, which a change made elsewhere may have shifted.
	let unsavedFacts = $state(false);
	/** "Copy my text" of the session in conflict (the English doc's or its translation's). */
	let copied = $state.raw<{ from: Session; result: 'yes' | 'failed' } | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	/** The translation's save state, as the English doc's above. */
	let tr = $state<{ status: string; lastSavedAt: number | null; error: string | null; unsavedBody: boolean; notice: string | null } | null>(null);

	$effect(() => {
		const s = trSession;
		if (!s) {
			tr = null;
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const sync = () => {
			tr = { status: s.queue.status, lastSavedAt: s.queue.lastSavedAt, error: s.queue.error, unsavedBody: s.unsavedBody() !== null, notice: s.notice };
			if (s.queue.status !== 'conflict' && copied?.from === s) copied = null;
			clearTimeout(timer);
			if (s.notice) timer = setTimeout(() => s.clearNotice(), 5000);
		};
		// Untracked: what sync reads (`copied`) must not re-run this effect.
		untrack(sync);
		const off = s.subscribe(sync);
		return () => {
			off();
			clearTimeout(timer);
		};
	});

	/** The sticky header's height (it wraps, and grows with a notice or a conflict); sticky panels below it offset by it. */
	let headerHeight = $state(0);

	onMount(() => {
		const sync = () => {
			if (!session) return;
			status = session.queue.status;
			lastSavedAt = session.queue.lastSavedAt;
			errorMsg = session.queue.error;
			notice = session.notice;
			unsavedBody = session.unsavedBody() !== null;
			unsavedFacts = session.queue.pending().some((op) => 'kind' in op && op.kind === 'facts');
			if (status !== 'conflict' && copied?.from === session) copied = null;
			clearTimeout(noticeTimer);
			if (notice) noticeTimer = setTimeout(() => session.clearNotice(), 5000);
		};
		const off = session?.subscribe(sync);
		const offTranslations = translations?.subscribe(() => opened++);
		session?.load().catch((e) => (errorMsg = String(e.message ?? e)));
		const gapWatch = ref ? createGapWatch(ref, () => allSessions().map((s) => s.doc?.version ?? '').join(), (g) => (gaps = g)) : null;
		const pinsWatch = ref && ref.kind !== 'hike' ? createPinsWatch(ref, () => session?.doc?.version ?? '', (p) => (hasPins = p)) : null;
		const id = setInterval(() => {
			tick = Date.now();
			gapWatch?.tick();
			pinsWatch?.tick();
		}, 1000);
		const check = () => {
			if (document.visibilityState === 'visible') for (const s of allSessions()) s.checkFresh().catch(() => {});
		};
		const poll = setInterval(check, 30000);
		window.addEventListener('focus', check);
		document.addEventListener('visibilitychange', check);
		const beforeUnload = (e: BeforeUnloadEvent) => {
			if (reloading) return;
			if (allSessions().some((s) => s.queue.pending().length || s.queue.status === 'conflict') || (session && leaveQuestion() !== null)) e.preventDefault();
		};
		window.addEventListener('beforeunload', beforeUnload);
		return () => {
			off?.();
			offTranslations?.();
			translations?.close();
			clearInterval(id);
			clearInterval(poll);
			clearTimeout(noticeTimer);
			window.removeEventListener('focus', check);
			document.removeEventListener('visibilitychange', check);
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});

	const statusText = (status: string, error: string | null, savedAt: number | null, now: number) =>
		status === 'saving'
			? 'Saving…'
			: status === 'error'
				? `Save failed: ${error ?? 'unknown error'}`
				: status === 'conflict'
					? 'Changed elsewhere'
					: savedAt === null
						? ''
						: `Saved ${Math.max(0, Math.floor((now - savedAt) / 1000))} s ago`;
	let saveStatus = $derived(statusText(status, errorMsg, lastSavedAt, tick));
	let trStatus = $derived(tr && statusText(tr.status, tr.error, tr.lastSavedAt, tick));

	async function copyMyText(from: Session) {
		const text = from.unsavedBody();
		if (text == null) return;
		try {
			await navigator.clipboard.writeText(text);
			copied = { from, result: 'yes' };
		} catch {
			copied = { from, result: 'failed' };
		}
	}

	/** Picks the second language; the label tables follow it to that language's table. */
	function pickLang(l: Lang) {
		setSecondLang(l);
		if (stringsLang && l !== stringsLang) location.search = new URLSearchParams({ strings: l }).toString();
	}

	function save() {
		for (const s of allSessions()) void s.queue.flush();
	}

	/** Leaving on purpose (Reload asked already): the page's own unsaved-edits warning stays quiet. */
	let reloading = false;
	let reloadBusy = $state(false);
	/**
	 * Reads everything from the files again (after an edit outside the CRM): saves what is queued, asks if anything would
	 * still be lost (a conflict, a failed save, a running upload), then reloads the page on the same tab. A whole reload,
	 * since each tab reads its own data (the OSM store, the facts library, photos) besides the doc.
	 */
	async function reload() {
		if (reloadBusy) return;
		reloadBusy = true;
		try {
			await Promise.allSettled(allSessions().map((s) => s.queue.flush()));
			const lost = allSessions().some((s) => s.queue.pending().length > 0 || s.queue.status === 'conflict' || s.queue.status === 'error');
			const q = leaveQuestion();
			if (lost && !confirm('Some edits could not be saved and will be lost. Reload anyway?')) return;
			if (!lost && q !== null && !confirm(q)) return;
			try {
				if (active) sessionStorage.setItem(RELOAD_TAB_KEY, active.id);
			} catch {
				/* no storage: the reload opens on Details */
			}
			reloading = true;
			location.reload();
		} finally {
			reloadBusy = false;
		}
	}
</script>

<!-- One banner for the English doc and its translation (prefixed "DE: "); its buttons act on the session in conflict. -->
{#snippet conflict(s: Session, prefix: string, hasBody: boolean, hasFacts: boolean)}
	<div class="conflict" role="alert">
		{prefix}Changed elsewhere. Your unsaved edits are kept.
		{#if hasFacts}<span class="line">Your facts edits are kept; list edits may land on other entries if the file changed.</span>{/if}
		{#if hasBody}
			<button type="button" onclick={() => copyMyText(s)}>{copied?.from === s && copied.result === 'yes' ? 'Copied' : 'Copy my text'}</button>
			{#if copied?.from === s && copied.result === 'failed'}<span>Copy failed: select all in the editor and copy by hand.</span>{/if}
		{/if}
		<button type="button" onclick={() => s.reloadDiscarding()}>Reload (discard my unsaved)</button>
		<button type="button" onclick={() => s.overwrite()}>Overwrite</button>
	</div>
{/snippet}

<div class="shell" style:--header-height={`${headerHeight}px`}>
	<header bind:offsetHeight={headerHeight} data-top-overlay>
		<div class="picker" data-slot="item-picker">
			{#if stringsLang}
				<button type="button" onclick={closeDoc}>Open…</button>
				<span>Label tables · {stringsLang.toUpperCase()}</span>
			{:else if session}
				<button type="button" onclick={closeDoc}>Open…</button>
				<span>{ref?.kind === 'place' ? `Place · ${ref.slug}` : `${ref?.slug}${ref?.kind === 'post' ? ` · ${ref.date}` : ''}`}</span>
			{:else}
				No item open
			{/if}
		</div>
		{#if session}
			<nav class="tabs top" aria-label="Sections">
				{#each tabs as t (t.id)}
					<button type="button" aria-current={t.id === active?.id ? 'page' : undefined} onclick={() => pick(t.id)}>{t.label}{@render gapDot(t.id)}</button>
				{/each}
			</nav>
		{/if}
		{#if session}
			<div class="status" data-slot="save-status" aria-live="polite">
				{saveStatus}{#if trStatus}{saveStatus ? ' · ' : ''}{trPrefix}{trStatus}{/if}
			</div>
		{/if}
		<!-- The one second language of the whole CRM, shown beside English. -->
		{#if OTHER_LANGS.length}
			<label class="lang">
				<span>Language</span>
				<select aria-label="Language" value={stringsLang ?? secondLang()} onchange={(e) => pickLang((e.currentTarget as HTMLSelectElement).value as Lang)}>
					{#each OTHER_LANGS as l (l)}
						<option value={l}>{l.toUpperCase()}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if notice}
			<div class="notice" role="status">{notice}</div>
		{/if}
		{#if tr?.notice}
			<div class="notice" role="status">{trPrefix}{tr.notice}</div>
		{/if}
		{#if status === 'conflict' && session}
			{@render conflict(session, '', unsavedBody, unsavedFacts)}
		{/if}
		{#if tr?.status === 'conflict' && trSession}
			{@render conflict(trSession, trPrefix, tr.unsavedBody, false)}
		{/if}
		{#if session}
			<button type="button" class="save" onclick={save}>Save</button>
			<button type="button" class="reload" title="Save, then read everything again from the files (after editing them outside the CRM)" disabled={reloadBusy} onclick={reload}
				>{reloadBusy ? 'Saving…' : 'Reload'}</button
			>
		{/if}
	</header>

	<main>
		{#if stringsLang && active}
			{@const Tab = active.component}
			<Tab {...active.props ?? {}} lang={stringsLang} />
		{:else if !session}
			<OpenScreen onopen={openDoc} />
		{:else if active}
			{@const Tab = active.component}
			<Tab {...active.props ?? {}} {session} {translations} hint={tabHint} openTab={pick} />
		{/if}
	</main>

	{#if session}
		<nav class="tabs bottom" aria-label="Sections" data-bottom-overlay>
			{#each tabs as t (t.id)}
				<button type="button" aria-current={t.id === active?.id ? 'page' : undefined} onclick={() => pick(t.id)}>{t.label}{@render gapDot(t.id)}</button>
			{/each}
		</nav>
	{/if}
</div>

{#snippet gapDot(tabId: string)}
	{#if tabHasGap(gaps, secondLang(), tabId)}<span class="gap-dot" role="img" aria-label="{secondLang()?.toUpperCase()} translation incomplete" title="{secondLang()?.toUpperCase()} translation incomplete"></span>{/if}
	{#if tabId === 'photos' && hasPins}<span class="pins-dot" role="img" aria-label="Photos have pins" title="At least one photo has pins"></span>{/if}
{/snippet}

<style>
	/* The phone tab bar's button height: the bar is this, its 1px top border and the safe area; sheets above it use it. */
	:global(:root) {
		--tab-bar-height: 2.75rem;
	}
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #fff;
		color: #111;
	}
	:global(button) {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border: 1px solid #888;
		background: #f4f4f4;
		color: inherit;
		border-radius: 4px;
		cursor: pointer;
	}
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #ccc;
		flex-wrap: wrap;
		position: sticky;
		top: 0;
		z-index: 20;
		background: #fff;
	}
	.picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 10rem;
		color: #555;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
	}
	.tabs button[aria-current='page'] {
		background: #fff;
		border-color: #111;
		border-bottom-width: 3px;
		font-weight: 700;
	}
	.gap-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-left: 0.3rem;
		border-radius: 50%;
		background: #c75b00;
		vertical-align: 0.1em;
	}
	/* Filled dark, like the Open screen's Facts badge: something there, not something missing. */
	.pins-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-left: 0.3rem;
		border-radius: 50%;
		background: #111;
		vertical-align: 0.1em;
	}
	.status {
		margin-left: auto;
		color: #555;
		min-width: 6rem;
	}
	.lang {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.lang select {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.5rem;
	}
	.notice {
		flex-basis: 100%;
		border: 1px solid #111;
		padding: 0.3rem 0.6rem;
	}
	.conflict {
		flex-basis: 100%;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		border: 2px solid #111;
		padding: 0.4rem 0.6rem;
	}
	.conflict .line {
		flex-basis: 100%;
	}
	main {
		padding: 1rem;
	}
	.bottom {
		display: none;
	}
	@media (max-width: 719px) {
		.top {
			display: none;
		}
		.bottom {
			display: flex;
			position: fixed;
			inset: auto 0 0 0;
			background: #fff;
			border-top: 1px solid #ccc;
		}
		.bottom {
			padding-bottom: env(safe-area-inset-bottom);
			z-index: 20;
		}
		.bottom button {
			flex: 1;
			/* Exactly the bar's height, whatever the label (two lines of "Details & files" included). */
			height: var(--tab-bar-height);
			min-height: 0;
			padding: 0 0.2rem;
			font-size: 0.8rem;
			line-height: 1.1;
		}
		header {
			gap: 0.5rem;
			padding: 0.4rem 0.75rem;
		}
		.status {
			min-width: 0;
		}
		/* The select alone on a phone; it keeps its name. */
		.lang span {
			display: none;
		}
		main {
			padding: 0.75rem 0.75rem 5rem;
		}
	}
</style>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Prec } from '@codemirror/state';
	import { EditorView, keymap } from '@codemirror/view';
	import { api } from '../api';
	import { setLeaveQuestion } from '../registry';
	import type { createDocSession } from '../doc-session';
	import { commandChange, commandsFor, type CommandId, type HookId } from '../write/commands';
	import { createEditor, type WriteEditor } from '../write/editor';
	import { createBodySync } from '../write/body-sync';
	import { captionText, mediaChips, mediaChipsExtension, ownFolderFor, photoOrder, posTracker } from '../write/media-chips';
	import { mediaInsert, mentionInsert, type MdChange } from '../../shared/md-lines';
	import { buildPlaceIndex } from '$lib/hikes/place-links';
	import { buildPlaceDocIndex } from '$lib/hikes/place-docs';
	import { keepFocus, linkedMentions, mentionMarks, mentionQuery, mentionSuggestions, popupPosition, setMentionMarks, suggestionKeyNames, suggestionKeys, type LinkedMention, type MapFocus, type Suggestion, type SuggestionList } from '../write/mentions';
	import { hikeLinkChange, typedLinkStart, type HikePost } from '../write/hike-links';
	import type { WritePlaces } from '../../server/api';
	import { docQuery } from '../photos/photo-api';
	import type { PostPhoto } from '../photos/types';
	import { undoUpdatedOp } from '../photos/undo-updated';
	import type { VideoResult, YoutubeResult } from '../../server/write-ops';
	import KeysOverlay from '../write/KeysOverlay.svelte';
	import InsertPhoto from '../write/InsertPhoto.svelte';
	import VideoDialog from '../write/VideoDialog.svelte';
	import YoutubeDialog from '../write/YoutubeDialog.svelte';
	import HikeLinkSearch from '../write/HikeLinkSearch.svelte';
	import SidePanel from '../write/SidePanel.svelte';
	import PinEditor from '../pins/PinEditor.svelte';
	import FieldForm from '../components/FieldForm.svelte';
	import ProblemsPanel from '../components/ProblemsPanel.svelte';
	import SideBySide from '../write/SideBySide.svelte';
	import { languageName, type Translations } from '../write/translation-session';
	import { secondLang } from '../lang.svelte';
	import FillButton from '../fill/FillButton.svelte';
	import { drafts } from '../fill/drafts.svelte';
	import { draftMarks, setDraftMarks } from '../fill/draft-marks';
	import { blockDraftKey, conflictOf, currentField, gatherDoc, type DocFill, type FillResult } from '../fill/fill';
	import { blocks, currentBody } from '../write/pairs';
	import { refSearch } from '../doc-session';

	type Session = ReturnType<typeof createDocSession>;
	let {
		session,
		translations = null,
		hint = null
	}: { session: Session; translations?: Translations | null; /** `'tr'`: opened to show the translation (Details' "Edit in Write"). */ hint?: string | null } = $props();

	// App opens one doc per page, so the session and its folder never change; a translation's chips use the same folder.
	const ownFolder = untrack(() => ownFolderFor(session.ref) ?? '');

	// ---- the language: English, the translation into the CRM's second language (a post's or a place doc's), or both
	// side by side, block by block
	let view = $state<'en' | 'tr' | 'side'>(untrack(() => (hint === 'tr' ? 'tr' : 'en')));
	let lang = $derived(translations && (session.ref.kind === 'post' || session.ref.kind === 'place') ? secondLang() : null);
	/** The translation is shown, alone or beside the English. */
	let showTr = $derived(view !== 'en' && lang !== null);
	let side = $derived(view === 'side' && lang !== null);
	/** The translation's session, opened the first time its language is shown. */
	let trSession = $state.raw<Session | null>(null);
	let trState = $state<'loading' | 'missing' | 'ready'>('loading');
	let trError = $state<string | null>(null);
	/** The error is the translation's load's (Retry reads it again), not a failed create's. */
	let trLoadFailed = $state(false);
	let creating = $state(false);
	/** The translation's version: its problems are checked again when it changes. */
	let trVersion = $state<string | null>(null);
	/** The session whose body the editor shows; none side by side. */
	let bodySession = $derived(side ? null : showTr ? (trState === 'ready' ? trSession : null) : session);

	$effect(() => {
		const l = showTr ? lang : null;
		trSession = l && translations ? untrack(() => translations.open(l)) : null;
	});

	$effect(() => {
		const s = trSession;
		const l = lang;
		if (!s || !l || !translations) return;
		const update = () => {
			trState = !s.doc ? 'loading' : s.doc.exists ? 'ready' : 'missing';
			trVersion = s.doc?.version ?? null;
		};
		update();
		trError = null;
		trLoadFailed = false;
		let stale = false;
		// A first load that failed and was retried since doesn't count.
		translations.loaded(l).catch((e) => {
			if (stale || s.doc) return;
			trError = e instanceof Error ? e.message : String(e);
			trLoadFailed = true;
		});
		const off = s.subscribe(update);
		return () => {
			stale = true;
			off();
		};
	});

	/** English, the translation or both; not while an upload or fetch runs (its line goes into this editor). */
	function pickView(next: 'en' | 'tr' | 'side') {
		if (busy || next === view) return;
		panel = null;
		more = false;
		sugg = null;
		view = next;
	}

	/** The translation's first load failed: read it again. */
	function retryLoad() {
		if (!lang || !translations) return;
		trError = null;
		trLoadFailed = false;
		translations
			.open(lang)
			.load()
			.catch((e) => {
				trError = e instanceof Error ? e.message : String(e);
				trLoadFailed = true;
			});
	}

	/** "Translate into …": the empty file, then its fields and editor. */
	async function createTranslation() {
		if (!lang || !translations || creating) return;
		creating = true;
		trError = null;
		trLoadFailed = false;
		try {
			await translations.create(lang);
		} catch (e) {
			trError = e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	// ---- "Fill empty from English": the translation's title, description and empty blocks, as DeepL drafts

	/** The translation as Fill reads it: the editor's text while the editor shows it (it is the truth then), else the session's. */
	function trNow(): DocFill {
		const tr = trSession!;
		const edited = editor && bodySession === tr;
		return {
			en: currentBody(session) ?? '',
			body: edited ? editor!.getText() : (currentBody(tr) ?? ''),
			title: String(currentField(tr, 'tr.title') ?? ''),
			description: String(currentField(tr, 'tr.description') ?? '')
		};
	}

	function gatherTr() {
		const src = session.ref.kind === 'place' ? 'place' : 'post';
		const now = trNow();
		return gatherDoc(now.en, now.body, now, { title: currentField(session, `${src}.title`), description: currentField(session, `${src}.description`) });
	}

	/** The filled title and description go as field edits; the body through the editor (an edit of mine, undoable) or the session. */
	function commitTr(r: FillResult<DocFill>) {
		const tr = trSession;
		if (!tr || !r.applied.length) return;
		const scope = refSearch(tr.ref);
		for (const field of ['title', 'description'] as const)
			if (r.applied.includes(`tr.${field}`)) tr.edit({ field: `tr.${field}`, value: r.state[field] }, true);
		const filledBlocks = r.applied.filter((id) => id.startsWith('block:'));
		drafts.add(scope, [...r.applied.filter((id) => id.startsWith('tr.')), ...filledBlocks.map((id) => blockDraftKey(r.filled[id]))]);
		if (!filledBlocks.length) return;
		if (editor && bodySession === tr) {
			const cur = editor.getText();
			let p = 0;
			while (p < cur.length && cur[p] === r.state.body[p]) p++;
			let q = 0;
			while (q < cur.length - p && cur[cur.length - 1 - q] === r.state.body[r.state.body.length - 1 - q]) q++;
			editor.view.dispatch({ changes: { from: p, to: cur.length - q, insert: r.state.body.slice(p, r.state.body.length - q) }, userEvent: 'input.fill' });
			markDrafts(tr);
		} else tr.edit({ kind: 'body', text: r.state.body }, true);
	}

	/** The editor's marks on the translation's draft blocks. */
	function markDrafts(tr: Session) {
		if (!editor) return;
		const scope = refSearch(tr.ref);
		setDraftMarks(
			editor.view,
			blocks(editor.getText())
				.filter((b) => drafts.has(scope, blockDraftKey(b.text)))
				.map((b) => ({ from: b.from, to: b.to }))
		);
	}

	// A place doc has no YouTube; a translation adds no media (they are added in English first).
	let commands = $derived(commandsFor(showTr && !side ? 'translation' : session.ref.kind));

	/** Photo, Video and YouTube open their panel; Link hike the post search, inserting at the cursor. */
	const hooks: Partial<Record<HookId, (editor: WriteEditor) => void>> = {
		photo: () => ((panel = 'photo'), void loadPhotos()),
		video: () => (panel = 'video'),
		youtube: () => (panel = 'youtube'),
		hikeLink: () => openHikeSearch(null)
	};
	const MEDIA: CommandId[] = ['photo', 'video', 'youtube'];

	// What the toolbar shows; the command's label is its accessible name.
	const TEXT: Record<CommandId, string> = {
		bold: 'B',
		italic: 'I',
		heading: 'H2',
		quote: '❝',
		list: '•',
		link: 'Link',
		german: 'DE',
		missing: '404',
		photo: 'Photo',
		video: 'Video',
		youtube: 'YouTube',
		hikeLink: '[[ ]]'
	};
	let secondary = $derived(commands.filter((c) => !c.primary));

	// 'none': a hike without a post has no text to write.
	let mode = $state<'loading' | 'none' | 'ready'>('loading');
	let more = $state(false);
	let keysOpen = $state(false);
	let editor: WriteEditor | null = null;

	// ---- media: the panel under the toolbar, the post's photos, the pin editor, notices
	let panel = $state<'photo' | 'video' | 'youtube' | 'hike' | null>(null);
	let photos = $state.raw<PostPhoto[]>([]);
	let photosLoading = $state(false);
	let photosError = $state<string | null>(null);
	/** Bumped on every text change, so what depends on the text (unplaced photos) follows it. */
	let textTick = $state(0);
	let pinsFor = $state<string | null>(null);
	let pinPhotos = $state.raw<PostPhoto[]>([]);
	let stamp = $state<{ previous: string | null } | null>(null);
	let note = $state<string | null>(null);
	/**
	 * The upload or YouTube fetch under way, one at a time: its panel stays as it is (switching panels would unmount
	 * it) and its line goes where the cursor was when it started, kept through the typing done meanwhile.
	 */
	let busy = $state<'video' | 'youtube' | null>(null);
	let insertAt: ReturnType<typeof posTracker> | null = null;
	let photosLoaded = false;

	/** Keys of the photos the text shows. */
	let placed = $derived.by(() => {
		void textTick;
		return new Set(editor ? mediaChips(editor.getText(), ownFolder).flatMap((c) => (c.key === undefined ? [] : [c.key])) : []);
	});
	let unplaced = $derived(photos.filter((p) => !placed.has(p.key)));

	async function loadPhotos(): Promise<PostPhoto[] | null> {
		photosLoading = true;
		try {
			photos = (await api<{ photos: PostPhoto[] }>('GET', `/api/photos/list?${docQuery(session)}`)).photos;
			photosLoaded = true;
			photosError = null;
			return photos;
		} catch (e) {
			photosError = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			photosLoading = false;
		}
	}

	/** `![caption](href)` on its own line at `pos` (default: the cursor), the caption selected. */
	function insertMedia(caption: string, href: string, pos?: number) {
		if (!editor) return;
		editor.apply(mediaInsert(editor.getText(), pos ?? editor.selection().from, caption, href));
	}

	/**
	 * A photo chip: the pin editor for its key, walking the photos in text order. It opens on the list already loaded
	 * and refreshes it in the background; a key the list lacks waits for a fresh list.
	 */
	async function openPins(key: string) {
		// An upload or YouTube fetch is running: its panel must stay as it is.
		if (busy || !editor) return;
		// The pin editor writes the English doc (pins, captions): it opens from the English text only.
		if (showTr) {
			note = 'Pins and captions are edited in English';
			return;
		}
		const cached = photosLoaded && photos.some((p) => p.key === key);
		const fresh = loadPhotos();
		const list = cached ? photos : await fresh;
		if (!list || !editor) return;
		if (!list.some((p) => p.key === key)) {
			note = `${key} isn’t one of this ${session.ref.kind === 'place' ? 'place doc' : 'post'}’s photos: add it in Photos to place pins`;
			return;
		}
		pinPhotos = photoOrder(editor.getText(), list, ownFolder);
		pinsFor = key;
		if (cached)
			void fresh.then((l) => {
				if (l && editor && pinsFor === key) pinPhotos = photoOrder(editor.getText(), l, ownFolder);
			});
	}

	// Leaving the tab cancels a running video upload (VideoDialog aborts it when it goes): the tab bar asks first.
	onMount(() => setLeaveQuestion(() => (busy === 'video' ? 'Cancel the video upload?' : null)));

	function mediaStart(kind: 'video' | 'youtube') {
		busy = kind;
		insertAt = editor ? posTracker(editor.selection().from) : null;
	}
	function mediaEnd() {
		busy = null;
		insertAt = null;
	}

	function videoDone(r: VideoResult) {
		const pos = insertAt?.get();
		mediaEnd();
		panel = null;
		insertMedia('', r.href, pos);
		if (r.stamped) stamp = { previous: r.previous ?? null };
	}

	function youtubeDone(r: YoutubeResult) {
		const pos = insertAt?.get();
		mediaEnd();
		panel = null;
		insertMedia(r.unavailable ? '' : captionText(r.title ?? ''), `https://www.youtube.com/watch?v=${r.id}`, pos);
		note = r.unavailable ? 'The video isn’t public, so it has no title: inserted with an empty caption' : null;
	}

	function undoStamp() {
		if (!stamp) return;
		session.edit(undoUpdatedOp(stamp.previous), false);
		stamp = null;
	}

	// ---- `[[`: the post search; a typed `[[` is replaced by the link, kept track of while the search has the focus
	let hikeAt: ReturnType<typeof posTracker> | null = null;

	function openHikeSearch(typed: number | null) {
		if (busy) return;
		hikeAt = typed === null ? null : posTracker(typed);
		panel = 'hike';
	}

	function pickHike(post: HikePost) {
		if (editor) editor.apply(hikeLinkChange(editor.getText(), editor.selection().from, post, hikeAt?.get() ?? null));
		closeHikeSearch();
	}

	function closeHikeSearch() {
		hikeAt = null;
		panel = null;
		editor?.view.focus();
	}

	// ---- places: what mentions can name (fresh from the server), the underlines, the suggestion list
	let places = $state.raw<WritePlaces | null>(null);
	let placeIndex = $derived(places && buildPlaceIndex(places.nodes, { origin: places.origin, height: places.height, keepRefs: places.ownRefs }));
	let docIndex = $derived(places && buildPlaceDocIndex(places.placeDocs));
	/** The underlined mentions as last computed (offsets as of then). */
	let mentions: LinkedMention[] = [];
	let marksTimer: ReturnType<typeof setTimeout> | undefined;

	async function loadPlaces() {
		try {
			places = await api<WritePlaces>('GET', `/api/write/places?${docQuery(session)}`);
		} catch {
			// Without them there are no suggestions or underlines; writing goes on.
		}
	}

	/** Recomputes the underlines a moment after the typing stops. */
	function scheduleMarks(delay = 250) {
		clearTimeout(marksTimer);
		marksTimer = setTimeout(() => {
			if (!editor) return;
			mentions = linkedMentions(editor.getText(), placeIndex, docIndex);
			setMentionMarks(editor.view, mentions);
			followCursor();
		}, delay);
	}

	$effect(() => {
		// New places (first load, or a refresh): underline with them.
		void placeIndex;
		void docIndex;
		untrack(() => scheduleMarks(0));
	});

	let sugg = $state.raw<{ from: number; to: number; items: Suggestion[]; active: number } | null>(null);
	let suggPos = $state<{ top: number; left: number } | null>(null);
	const SUGG_ROW = 44;
	const suggKeys = suggestionKeyNames();
	/** The key hint under the options. */
	const SUGG_HINT = 28;

	const suggestions: SuggestionList = {
		open: () => !!sugg?.items.length,
		active: () => sugg?.active ?? -1,
		move: (d) => {
			if (!sugg) return;
			const n = sugg.items.length;
			sugg = { ...sugg, active: sugg.active < 0 ? (d > 0 ? 0 : n - 1) : (sugg.active + d + n) % n };
		},
		accept: () => acceptSuggestion(sugg?.active ?? -1),
		close: () => void (sugg = null)
	};

	function acceptSuggestion(i: number): boolean {
		const s = sugg;
		const item = s?.items[i];
		if (!editor || !s || !item) return false;
		sugg = null;
		const change: MdChange = item.node ? mentionInsert(s.from, s.to, item.node) : { from: s.from, to: s.to, insert: item.text, selFrom: s.from + item.text.length, selTo: s.from + item.text.length };
		editor.apply(change);
		return true;
	}

	/** After typing or deleting: the word before the cursor, and what it may be the start of. */
	function suggestFor(view: EditorView) {
		const { head, empty } = view.state.selection.main;
		const q = empty && places ? mentionQuery(view.state.doc.sliceString(Math.max(0, head - 64), head + 1), Math.min(head, 64)) : null;
		const items = q && places ? mentionSuggestions(q.word, places.nodes, places.placeDocs, places.origin) : [];
		if (!q || !items.length) {
			sugg = null;
			return;
		}
		const from = head - q.word.length;
		// The highlight stays off until an arrow key: Enter and Tab keep their meaning while typing on.
		sugg = { from, to: head, items, active: -1 };
		placeSuggestions(view, from);
	}

	/** Under the word, or above it when the keyboard (the visual viewport's bottom) is close. */
	function placeSuggestions(view: EditorView, at: number) {
		view.requestMeasure({
			read: (v) => v.coordsAtPos(at),
			write: (caret) => {
				if (!caret || !sugg) return;
				const vv = window.visualViewport;
				const viewport = vv ? { top: vv.offsetTop, height: vv.height, width: vv.width } : { top: 0, height: window.innerHeight, width: window.innerWidth };
				suggPos = popupPosition(caret, viewport, { width: Math.min(320, viewport.width - 16), height: sugg.items.length * SUGG_ROW + SUGG_HINT + 4 });
			}
		});
	}

	/** The visual viewport's height (it shrinks while the on-screen keyboard is open), for the editor's height; null: 100dvh. */
	let viewportHeight = $state<number | null>(null);

	/** The page or the on-screen keyboard moved: the list goes with the word, the editor fits what is visible. */
	function replaceSuggestions() {
		viewportHeight = window.visualViewport?.height ?? null;
		if (sugg && editor) placeSuggestions(editor.view, sugg.from);
	}

	onMount(() => {
		// The keyboard opening or closing changes the visual viewport, not the window.
		const vv = window.visualViewport;
		viewportHeight = vv?.height ?? null;
		vv?.addEventListener('resize', replaceSuggestions);
		vv?.addEventListener('scroll', replaceSuggestions);
		return () => {
			vv?.removeEventListener('resize', replaceSuggestions);
			vv?.removeEventListener('scroll', replaceSuggestions);
		};
	});

	// ---- the side panel's map: the photo or the mention at the cursor
	let mapFocus = $state.raw<MapFocus | null>(null);

	function followCursor() {
		if (!editor) return;
		const state = editor.view.state;
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		const key = mediaChips(line.text, ownFolder).find((c) => c.key !== undefined)?.key;
		const photo = key === undefined ? undefined : photos.find((p) => p.key === key);
		if (photo?.lat !== undefined && photo.lon !== undefined) {
			mapFocus = keepFocus(mapFocus, { lat: photo.lat, lon: photo.lon, label: photo.key });
			return;
		}
		const m = mentions.find((m) => m.node && m.from <= head && head <= m.to);
		if (m?.node) mapFocus = keepFocus(mapFocus, { lat: m.node.lat, lon: m.node.lon, label: state.doc.sliceString(m.from, Math.min(m.to, state.doc.length)) });
	}

	/** While an upload or fetch runs, the other media commands wait. */
	const blocked = (id: CommandId) => busy !== null && MEDIA.includes(id) && id !== busy;
	const title = (c: (typeof commands)[number]) => (c.shortcut ? `${c.label} (${c.shortcut})` : c.label);

	function run(id: CommandId) {
		more = false;
		const c = commands.find((c) => c.id === id);
		if (!editor || !c || blocked(id)) return;
		if (c.hook) {
			hooks[id as HookId]?.(editor);
			return;
		}
		const change = commandChange(id, editor.selection());
		if (change) editor.apply(change);
		else editor.view.focus();
	}

	/** Creates the editor in its container and keeps it in step with the session until the container goes. */
	function mountEditor(node: HTMLElement, body: Session) {
		const ed = createEditor(node, {
			text: '',
			onChange: () => sync.changed(),
			run,
			onKeys: () => (keysOpen = true),
			extensions: [
				Prec.highest(keymap.of(suggestionKeys(suggestions))),
				mediaChipsExtension({ ownFolder, onPhoto: (key) => void openPins(key), onDrop: (href, pos) => insertMedia('', href, pos) }),
				mentionMarks,
				draftMarks,
				// The list follows the word when the editor scrolls (typing at the bottom scrolls it too).
				EditorView.domEventHandlers({ blur: () => void (sugg = null), scroll: (_e, view) => void (sugg && placeSuggestions(view, sugg.from)) }),
				EditorView.updateListener.of((u) => {
					if (u.docChanged) {
						textTick++;
						insertAt?.map(u.changes);
						hikeAt?.map(u.changes);
						scheduleMarks();
					}
					const typed = u.transactions.some((t) => t.isUserEvent('input.type'));
					if (typed) {
						// `[[` just typed: the post search.
						let inserted = '';
						u.changes.iterChanges((_a, _b, _c, _d, text) => (inserted = text.toString()));
						const head = u.state.selection.main.head;
						const at = typedLinkStart(u.state.doc.sliceString(Math.max(0, head - 2), head), Math.min(head, 2), inserted);
						if (at !== null) {
							sugg = null;
							openHikeSearch(head - 2);
							return;
						}
					}
					if (typed || u.transactions.some((t) => t.isUserEvent('delete'))) suggestFor(u.view);
					else if (u.docChanged || u.selectionSet) sugg = null;
					if (u.selectionSet) followCursor();
				})
			]
		});
		const sync = createBodySync(body, ed.getText, ed.setText);
		editor = ed;
		if (body.ref.kind === 'translation') markDrafts(body);
		void loadPhotos();
		void loadPlaces();
		return {
			destroy() {
				clearTimeout(marksTimer);
				sync.destroy();
				ed.destroy();
				editor = null;
			}
		};
	}

	onMount(() => {
		const update = () => {
			const d = session.doc;
			mode = !d ? 'loading' : typeof d.body === 'string' ? 'ready' : 'none';
		};
		update();
		return session.subscribe(update);
	});

	// The More menu closes on a tap anywhere outside it (its toggle toggles).
	function onpointerdown(e: PointerEvent) {
		if (more && !(e.target as Element | null)?.closest?.('.more-menu, .more-toggle')) more = false;
	}

	// Ctrl+/ also works with the focus outside the editor (the editor's own binding handles it inside).
	function onkeydown(e: KeyboardEvent) {
		if (more && e.key === 'Escape') {
			more = false;
			return;
		}
		if (e.defaultPrevented || mode !== 'ready') return;
		if ((e.ctrlKey || e.metaKey) && e.key === '/') {
			e.preventDefault();
			keysOpen = true;
		}
	}
</script>

<svelte:window {onkeydown} {onpointerdown} onfocus={() => mode === 'ready' && void loadPlaces()} onscroll={replaceSuggestions} onresize={replaceSuggestions} />

{#if mode === 'loading'}
	<p>Loading…</p>
{:else if mode === 'none'}
	<p>No post yet: the text belongs to a dated visit of this hike.</p>
{:else}
	<div class="write" style:--viewport-height={viewportHeight === null ? undefined : `${viewportHeight}px`}>
		{#if lang}
			<div class="langs" role="group" aria-label="Text language">
				<button type="button" aria-pressed={!showTr} disabled={busy !== null} onclick={() => pickView('en')}>English</button>
				<button type="button" aria-pressed={showTr && !side} disabled={busy !== null} onclick={() => pickView('tr')}>{lang.toUpperCase()}</button>
				<button type="button" aria-pressed={side} disabled={busy !== null} onclick={() => pickView('side')}>Side by side</button>
			</div>
		{/if}
		{#if showTr && lang && trSession && trState === 'ready'}
			<FillButton doc={refSearch(session.ref)} surface="write" {lang} gather={gatherTr} current={trNow} commit={commitTr} disabled={busy !== null} blocked={conflictOf(session, trSession)} />
		{/if}
		{#if showTr && lang && trState !== 'ready'}
			{#if trError}
				<p class="error" role="alert">{trError}</p>
				{#if trLoadFailed}
					<div><button type="button" onclick={retryLoad}>Retry</button></div>
				{/if}
			{/if}
			{#if trState === 'missing'}
				<p>No {languageName(lang)} translation yet.</p>
				<div><button type="button" disabled={creating} onclick={createTranslation}>Translate into {languageName(lang)}</button></div>
			{:else if !trError}
				<p>Loading…</p>
			{/if}
		{:else if side && lang && trSession}
			{#key trSession}
				<SideBySide en={session} tr={trSession} {lang} {ownFolder} />
				<div class="tr-problems"><ProblemsPanel ref={trSession.ref} refreshKey={trVersion} /></div>
			{/key}
		{:else}
			{#if showTr && trSession}
				{#key trSession}
					<div class="tr-fields"><FieldForm session={trSession} /></div>
				{/key}
			{/if}
			<!-- mousedown is cancelled so the editor keeps its focus and selection while a button is used -->
			<div class="toolbar" role="toolbar" aria-label="Formatting" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
				{#each commands as c (c.id)}
					<button
						type="button"
						class:secondary={!c.primary}
						class={c.id}
						aria-label={c.label}
						aria-keyshortcuts={c.key ? c.shortcut?.replaceAll('Ctrl', 'Control') : undefined}
						title={title(c)}
						disabled={blocked(c.id)}
						onclick={() => run(c.id)}>{TEXT[c.id]}</button
					>
				{/each}
				<button type="button" class="more-toggle" aria-expanded={more} aria-controls="write-more" onclick={() => (more = !more)}>More</button>
				<button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (Ctrl+/)" onclick={() => (keysOpen = true)}>Keys</button>
			</div>
			{#if more}
				<div class="more-menu" id="write-more" role="menu" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
					{#each secondary as c (c.id)}
						<button type="button" role="menuitem" title={title(c)} disabled={blocked(c.id)} onclick={() => run(c.id)}>{c.label}{c.shortcut ? ` · ${c.shortcut}` : ''}</button>
					{/each}
				</div>
			{/if}
			{#if stamp}
				<div class="notice" role="status">
					Marked as updated today — <button type="button" onclick={undoStamp}>Undo</button>
					<button type="button" class="x" aria-label="Dismiss" onclick={() => (stamp = null)}>×</button>
				</div>
			{/if}
			{#if note}
				<div class="notice" role="status">
					{note}
					<button type="button" class="x" aria-label="Dismiss" onclick={() => (note = null)}>×</button>
				</div>
			{/if}
			{#if panel === 'photo'}
				<InsertPhoto photos={unplaced} loading={photosLoading} error={photosError} onpick={(p) => insertMedia('', p.href)} onclose={() => ((panel = null), editor?.view.focus())} />
			{:else if panel === 'video'}
				<VideoDialog {session} onstart={() => mediaStart('video')} onfail={mediaEnd} ondone={videoDone} onclose={() => ((panel = null), editor?.view.focus())} />
			{:else if panel === 'youtube'}
				<YoutubeDialog {session} onstart={() => mediaStart('youtube')} onfail={mediaEnd} ondone={youtubeDone} onclose={() => ((panel = null), editor?.view.focus())} />
			{:else if panel === 'hike'}
				<HikeLinkSearch onpick={pickHike} onclose={closeHikeSearch} />
			{/if}
			<div class="main">
				{#if bodySession}
					{#key bodySession}
						<div class="editor" use:mountEditor={bodySession}></div>
					{/key}
				{/if}
				<SidePanel focus={mapFocus} origin={places?.origin ?? null} photos={unplaced} loading={photosLoading} error={photosError} onpick={(p) => insertMedia('', p.href)} />
			</div>
			{#if showTr && trSession}
				<div class="tr-problems"><ProblemsPanel ref={trSession.ref} refreshKey={trVersion} /></div>
			{/if}
		{/if}
	</div>
	{#if sugg && suggPos}
		<!-- Taps keep the editor's focus (mousedown cancelled): the keyboard stays up and typing goes on. -->
		<ul class="suggestions" role="listbox" aria-label="Places" style:top="{suggPos.top}px" style:left="{suggPos.left}px" onmousedown={(e) => e.preventDefault()}>
			{#each sugg.items as item, i (item.text)}
				<li role="option" aria-selected={i === sugg.active}>
					<button type="button" tabindex="-1" class:active={i === sugg.active} onclick={() => acceptSuggestion(i)}>
						{item.text}{#if !item.node}<small> · place doc</small>{/if}
					</button>
				</li>
			{/each}
			<li class="keys" role="presentation">{suggKeys.next} to choose, {suggKeys.accept} to insert, {suggKeys.close} to close</li>
		</ul>
	{/if}
{/if}

{#if pinsFor}
	<PinEditor {session} photos={pinPhotos} key={pinsFor} onclose={() => ((pinsFor = null), editor?.view.focus())} />
{/if}

{#if keysOpen}
	<KeysOverlay {commands} onclose={() => ((keysOpen = false), editor?.view.focus())} />
{/if}

<style>
	.write {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.langs {
		display: flex;
		gap: 0.25rem;
	}
	.langs button {
		min-width: 2.75rem;
	}
	.langs button[aria-pressed='true'] {
		background: #fff;
		border-color: #111;
		border-bottom-width: 3px;
		font-weight: 700;
	}
	.tr-fields,
	.tr-problems {
		max-width: 48rem;
	}
	.error {
		color: #b00;
		margin: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.toolbar button {
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
	.toolbar .bold {
		font-weight: 700;
	}
	.toolbar .italic {
		font-style: italic;
		font-family: Georgia, serif;
	}
	.more-toggle,
	.more-menu {
		display: none;
	}
	.notice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		border: 1px solid #111;
		border-radius: 4px;
		padding: 0.3rem 0.6rem;
	}
	.x {
		margin-left: auto;
		min-width: 2.75rem;
		padding: 0 0.7rem;
	}
	/* A media line's chip: thumbnail or label before the line's own text, which stays editable. */
	.editor :global(.cm-media-chip) {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		vertical-align: middle;
		margin-right: 0.4rem;
		padding: 2px 0.4rem 2px 2px;
		border: 1px solid #bbb;
		border-radius: 4px;
		background: #f4f4f4;
		color: #333;
		font: 0.8rem system-ui, sans-serif;
		user-select: none;
	}
	.editor :global(.cm-media-chip img) {
		height: 2.5rem;
		width: auto;
		max-width: 4.5rem;
		object-fit: cover;
		border-radius: 3px;
		background: #ddd;
	}
	.editor :global(.cm-media-chip-photo) {
		cursor: pointer;
		padding-right: 2px;
		min-width: 2.75rem;
		justify-content: center;
	}
	.editor :global(.cm-media-chip-missing) {
		border-color: #b00;
		color: #b00;
	}
	.main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 0.5rem;
		align-items: start;
	}
	.editor {
		border: 1px solid #888;
		border-radius: 4px;
	}
	/* A mention the site links to the map (or to a place doc). */
	.editor :global(.cm-place-mention) {
		text-decoration: underline dotted #1565c0 2px;
		text-underline-offset: 3px;
	}
	.suggestions {
		position: fixed;
		z-index: 50;
		width: min(20rem, calc(100vw - 1rem));
		margin: 0;
		padding: 2px;
		list-style: none;
		background: #fff;
		color: #111;
		border: 1px solid #888;
		border-radius: 4px;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
	}
	.suggestions button {
		display: block;
		width: 100%;
		min-height: 2.75rem;
		text-align: left;
		border: 1px solid transparent;
		background: none;
		padding: 0 0.5rem;
	}
	.suggestions button.active {
		border-color: #111;
		background: #eef3ff;
	}
	.suggestions small {
		color: #444;
	}
	.suggestions .keys {
		padding: 0.25rem 0.5rem;
		border-top: 1px solid #ddd;
		color: #444;
		font-size: 0.75rem;
	}
	/* A light editor in plain CSS (no theme package); the editor scrolls itself so the toolbar stays in view. */
	.editor :global(.cm-editor) {
		height: calc(var(--viewport-height, 100dvh) - 12rem);
		min-height: 16rem;
		background: #fff;
		color: #111;
		font-size: 1rem;
	}
	.editor :global(.cm-editor.cm-focused) {
		outline: 2px solid #111;
		outline-offset: 1px;
	}
	.editor :global(.cm-scroller) {
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		line-height: 1.55;
	}
	/* A dashed ruler after column 80 (0.7rem: the line padding); room past it so long lines show before they wrap. */
	.editor :global(.cm-content) {
		padding: 0.6rem 0;
		max-width: calc(90ch + 1.4rem);
		position: relative;
	}
	/* A border, not a background gradient: dark-mode extensions (Dark Reader) darken gradients but lighten borders. */
	.editor :global(.cm-content::after) {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(0.7rem + 80ch);
		border-left: 1px dashed rgb(128 128 128 / 0.55);
		pointer-events: none;
	}
	.editor :global(.cm-line) {
		padding: 0 0.7rem;
	}
	.editor :global(.cm-panels) {
		background: #f4f4f4;
		color: #111;
	}
	/* Line numbers: one per line of the file (a wrapped line keeps one number), the cursor's line in bold. */
	.editor :global(.cm-gutters) {
		background: #f4f4f4;
		color: #767676;
		border-right: 1px solid #ddd;
	}
	.editor :global(.cm-lineNumbers .cm-gutterElement) {
		padding: 0 0.4rem 0 0.5rem;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	.editor :global(.cm-activeLineGutter) {
		background: #e6e6e6;
		color: #111;
		font-weight: 600;
	}
	.editor :global(.cm-cursor-pos) {
		padding: 0.15rem 0.7rem;
		font-size: 0.8rem;
		color: #444;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.editor :global(.cm-searchMatch) {
		background: #ffe58a;
	}
	.editor :global(.cm-searchMatch-selected),
	.editor :global(.cm-selectionMatch) {
		background: #d6e8ff;
	}
	@media (max-width: 900px) {
		.main {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 600px) {
		/* Room for the side panel's folded sheet (its toggle) above the tab bar, so the editor's end scrolls clear of it. */
		.write {
			padding-bottom: calc(var(--tab-bar-height) + 1px);
		}
		.toolbar .secondary {
			display: none;
		}
		.more-toggle {
			display: inline-block;
		}
		.more-menu {
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
			border: 1px solid #888;
			border-radius: 4px;
			padding: 0.25rem;
		}
		.more-menu button {
			text-align: left;
		}
		.editor :global(.cm-editor) {
			height: calc(var(--viewport-height, 100dvh) - 15rem);
		}
	}
</style>

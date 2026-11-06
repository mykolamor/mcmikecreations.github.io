<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ArrowLeftOutline, ArrowRightOutline, CompressOutline, ExpandOutline, GridOutline } from 'flowbite-svelte-icons';
	import { isLang } from '$lib/i18n/languages';
	import { t } from '$lib/i18n/strings';
	import { PresentationController } from './controller';
	import { parseHash } from './deep-link';
	import { keyCommand, swipeCommand, type Command } from './input';
	import { pick } from './localize';
	import { initialPosition, normalize } from './order';
	import PresentationGrid from './PresentationGrid.svelte';
	import { DomSlideHost } from './slide-host';
	import { readTheme, watchTheme } from './theme';
	import type { Env, Lang, Position, PositionRef, PresentationApi, PresentationDef, Theme } from './types';

	type ClaimKind = 'keys' | 'drag';

	let {
		definition,
		caption,
		lang,
		theme,
		start,
		fallbackName
	}: {
		definition: PresentationDef;
		caption?: string;
		lang?: Lang;
		theme?: Theme;
		start?: PositionRef;
		fallbackName?: string;
	} = $props();

	const CANVAS_W = 1600;
	const CANVAS_H = 900;
	const hasDom = typeof document !== 'undefined';

	function pageLang(): Lang {
		const l = hasDom ? document.documentElement.lang : '';
		return isLang(l) ? l : 'en';
	}

	// The env source the slide host reads. A plain object owned here (never `controller.env`): the
	// controller's constructor mounts the first slide, whose ctx getters call `env()`, before `controller`
	// is assigned. On a change it's updated first, then the controller is told.
	// svelte-ignore state_referenced_locally
	const env: Env = { lang: lang ?? pageLang(), theme: theme ?? (hasDom ? readTheme() : 'light'), reducedMotion: false };

	// The definition is fixed for the frame's lifetime.
	// svelte-ignore state_referenced_locally
	const p = normalize(definition, fallbackName);

	let root: HTMLElement;
	let stage: HTMLElement;
	let canvas: HTMLElement;
	let controller: PresentationController | null = null;

	let uiLang = $state<Lang>(env.lang);
	/** A theme set by the `theme` prop or the API. It pins the frame (rendered as `data-theme`) and stops it
	 *  following the page's dark toggle; without one, the `.dark` ancestor decides, in SSR too. */
	// svelte-ignore state_referenced_locally
	let explicitTheme = $state<Theme | null>(theme ?? null);
	/** Mirrors `env.theme` for the UI (the grid refetches image thumbnails when it changes). */
	let uiTheme = $state<Theme>(env.theme);
	let pos = $state<Position>({ slide: 0, state: 0 });
	let announcement = $state('');
	let gridOpen = $state(false);
	let fsNative = $state(false);
	let fsOverlay = $state(false);
	let stageW = $state(0);
	let stageH = $state(0);

	const fullscreen = $derived(fsNative || fsOverlay);
	const scale = $derived(stageW > 0 && stageH > 0 ? Math.min(stageW / CANVAS_W, stageH / CANVAS_H) : 0);
	const offsetX = $derived((stageW - CANVAS_W * scale) / 2);
	const offsetY = $derived((stageH - CANVAS_H * scale) / 2);
	const atFirst = $derived(pos.slide === 0 && pos.state === 0);
	const atLast = $derived(pos.slide === p.slides.length - 1 && pos.state === p.slides[pos.slide].states.length - 1);
	const regionLabel = $derived(t(uiLang, 'presentation.region', { caption: caption || p.name }));
	const positionText = $derived(
		t(uiLang, 'presentation.position', {
			slide: pos.slide + 1,
			slides: p.slides.length,
			state: pos.state + 1,
			states: p.slides[pos.slide].states.length
		})
	);

	/** What the live region reads for a position: the state's label, else the slide's, else `presentation.slideState`. */
	function positionLabel(at: Position): string {
		const s = p.slides[at.slide];
		const label = s.states[at.state]?.label ?? s.label;
		return label !== undefined
			? pick(label, env.lang)
			: t(env.lang, 'presentation.slideState', { slide: at.slide + 1, state: at.state + 1 });
	}

	// --- Input claimed by content ---------------------------------------------------------------
	const claims = new WeakMap<Element, Set<ClaimKind>>();
	/** Set by Esc or a toolbar click: claimed elements stop holding the keys until used again. */
	let keysReleased = false;

	function claim(el: Element, kinds: ClaimKind[]): void {
		const set = claims.get(el) ?? new Set<ClaimKind>();
		for (const k of kinds) set.add(k);
		claims.set(el, set);
	}

	function claimed(target: EventTarget | null, kind: ClaimKind): boolean {
		for (let n = target instanceof Element ? target : null; n && n !== root; n = n.parentElement) {
			if (claims.get(n)?.has(kind)) return true;
		}
		return false;
	}

	// --- Env changes: env source first, then the controller ------------------------------------
	function applyLang(l: Lang): void {
		if (!isLang(l)) return;
		env.lang = l;
		uiLang = l;
		controller?.setLanguage(l);
	}

	/** An explicit theme (prop or API): pins the frame's theme. */
	function applyTheme(th: Theme): void {
		explicitTheme = th;
		// Set directly (not via a Svelte flush) so the --pres-* colours are already switched when slides'
		// update hooks call ctx.color().
		if (root) root.dataset.theme = th;
		setEnvTheme(th);
	}

	/** The page's dark toggle: followed only while no theme was set explicitly. */
	function applyPageTheme(th: Theme): void {
		if (explicitTheme === null) setEnvTheme(th);
	}

	function setEnvTheme(th: Theme): void {
		env.theme = th;
		uiTheme = th;
		controller?.setTheme(th);
	}

	function applyReducedMotion(on: boolean): void {
		env.reducedMotion = on;
		controller?.setReducedMotion(on);
	}

	$effect(() => {
		if (lang) applyLang(lang);
	});
	$effect(() => {
		if (theme) applyTheme(theme);
	});

	// --- Grid and fullscreen -------------------------------------------------------------------
	/** Created on first open, then kept mounted (hidden) so reopening is instant. */
	let gridCreated = $state(false);
	let host = $state<DomSlideHost | null>(null);

	function setGrid(on: boolean): void {
		if (gridOpen === on) return;
		gridOpen = on;
		if (on) gridCreated = true;
		// Closing hands focus back to the frame so keyboard navigation continues.
		else root?.focus({ preventScroll: true });
	}

	function toggleGrid(): void {
		setGrid(!gridOpen);
	}

	function pickFromGrid(at: Position): void {
		controller?.goTo(at, { animate: true });
		setGrid(false);
	}

	let savedOverflow = '';
	function setOverlay(on: boolean): void {
		if (fsOverlay === on) return;
		fsOverlay = on;
		const html = document.documentElement;
		if (on) {
			savedOverflow = html.style.overflow;
			html.style.overflow = 'hidden';
		} else {
			html.style.overflow = savedOverflow;
		}
	}

	function toggleFullscreen(): void {
		if (fsNative) {
			void document.exitFullscreen().catch(() => {});
		} else if (fsOverlay) {
			setOverlay(false);
		} else if (document.fullscreenEnabled) {
			root.requestFullscreen().then(
				() => root.focus({ preventScroll: true }),
				() => setOverlay(true)
			);
		} else {
			// iPhone Safari: no Fullscreen API on elements; a full-viewport overlay instead.
			setOverlay(true);
		}
	}

	// --- Commands ------------------------------------------------------------------------------
	function run(cmd: Exclude<Command, 'escape'>): void {
		if (!controller) return;
		switch (cmd) {
			case 'next': controller.next(); break;
			case 'prev': controller.prev(); break;
			case 'first': controller.first(); break;
			case 'last': controller.last(); break;
			case 'grid': toggleGrid(); break;
			case 'fullscreen': toggleFullscreen(); break;
		}
	}

	/** A toolbar click: releases claimed input, runs the command, and keeps focus in the frame. */
	async function toolbar(cmd: Exclude<Command, 'escape'>): Promise<void> {
		keysReleased = true;
		run(cmd);
		await tick();
		if (!root) return;
		const active = document.activeElement;
		// A button disabled under the focus (prev at the start, next at the end) drops it to <body>.
		if (!root.contains(active) || (active as HTMLButtonElement).disabled) root.focus({ preventScroll: true });
	}

	const CLAIMABLE_KEYS = new Set(['ArrowLeft', 'ArrowRight', ' ']);

	/** A text-entry control inside a slide: its keys are its own (only Esc still reaches the frame). */
	function isEditable(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
		return target.closest('textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]') !== null;
	}

	const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset']);

	const STEPPED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

	/** A range or radio input: the arrow-like keys change its value, so the frame leaves them alone. */
	function isStepped(target: EventTarget | null): boolean {
		return target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'radio');
	}

	function isControl(target: EventTarget | null): boolean {
		return target instanceof Element && target.closest('button, a[href], input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
	}

	function onKeydown(e: KeyboardEvent): void {
		const cmd = keyCommand(e);
		if (!cmd || !controller) return;
		if (cmd === 'escape') {
			if (gridOpen) setGrid(false);
			else if (!keysReleased && claimed(e.target, 'keys')) {
				keysReleased = true;
				root.focus({ preventScroll: true });
			} else if (fsOverlay) setOverlay(false);
			else if (fsNative) void document.exitFullscreen().catch(() => {});
			else return;
			e.preventDefault();
			return;
		}
		if (isEditable(e.target)) return;
		// A slider or radio group moves with the arrows (and Home/End/PageUp/PageDown) itself.
		if (STEPPED_KEYS.has(e.key) && isStepped(e.target)) return;
		if (CLAIMABLE_KEYS.has(e.key) && !keysReleased && claimed(e.target, 'keys')) return;
		// Space on a button or field is that control's own.
		if (e.key === ' ' && isControl(e.target)) return;
		// The grid takes the navigation keys while it's open.
		if (gridOpen && cmd !== 'grid' && cmd !== 'fullscreen') return;
		e.preventDefault();
		run(cmd);
	}

	function onFocusin(e: FocusEvent): void {
		if (claimed(e.target, 'keys')) keysReleased = false;
	}

	let gesture: { id: number; x: number; y: number; t: number } | null = null;
	/** Movement after which a touch is taken as a swipe and the pointer captured to the stage. Capturing
	 *  on pointerdown would retarget a plain tap's click to the stage and break buttons/links in slides. */
	const CAPTURE_AFTER = 10;

	function onPointerdown(e: PointerEvent): void {
		if (claimed(e.target, 'keys')) keysReleased = false;
		gesture = null;
		// The grid scrolls; it doesn't swipe between slides.
		if (gridOpen || !e.isPrimary || e.pointerType === 'mouse' || claimed(e.target, 'drag')) return;
		gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
	}

	function onPointermove(e: PointerEvent): void {
		const g = gesture;
		if (!g || e.pointerId !== g.id || stage.hasPointerCapture(e.pointerId)) return;
		// A swipe that ends outside the stage still reaches pointerup here.
		if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > CAPTURE_AFTER) {
			try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
		}
	}

	function endGesture(e: PointerEvent): void {
		gesture = null;
		if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
	}

	function onPointerup(e: PointerEvent): void {
		const g = gesture;
		if (!g || e.pointerId !== g.id) return;
		endGesture(e);
		const cmd = swipeCommand(e.clientX - g.x, e.clientY - g.y, e.timeStamp - g.t);
		if (cmd) run(cmd);
	}

	function onPointercancel(e: PointerEvent): void {
		if (gesture?.id === e.pointerId) endGesture(e);
	}

	onMount(() => {
		const listeners = new AbortController();
		const signal = listeners.signal;

		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		env.reducedMotion = reduced.matches;

		const rect = stage.getBoundingClientRect();
		stageW = rect.width;
		stageH = rect.height;
		const resize = new ResizeObserver((entries) => {
			const box = entries[entries.length - 1].contentRect;
			stageW = box.width;
			stageH = box.height;
		});
		resize.observe(stage);

		const slideHost = new DomSlideHost(p, canvas, () => env, claim);
		host = slideHost;
		const hashRef = parseHash(location.hash, p);
		const first = initialPosition(p, [hashRef, start]);
		const ctl = new PresentationController(p, slideHost, first, env);
		controller = ctl;
		pos = first;
		if (hashRef) root.scrollIntoView({ block: 'nearest' });

		const offChange = ctl.on('change', (at) => {
			pos = at;
			announcement = positionLabel(at);
		});

		const api: PresentationApi = {
			next: () => ctl.next(),
			prev: () => ctl.prev(),
			first: () => ctl.first(),
			last: () => ctl.last(),
			goTo: (ref, opts) => ctl.goTo(ref, opts),
			setLanguage: (l) => applyLang(l),
			setTheme: (th) => applyTheme(th),
			on: (event, fn) => ctl.on(event, fn),
			get position() { return ctl.position; },
			toggleGrid,
			toggleFullscreen
		};
		const el = root as HTMLElement & { presentation?: PresentationApi };
		el.presentation = api;

		const stopTheme = watchTheme((th) => applyPageTheme(th));
		reduced.addEventListener('change', (e) => applyReducedMotion(e.matches), { signal });

		window.addEventListener('hashchange', () => {
			const ref = parseHash(location.hash, p);
			if (ref && ctl.goTo(ref)) root.scrollIntoView({ block: 'nearest' });
		}, { signal });
		// Clicking a deep link whose hash is already the page's fires no hashchange (and SvelteKit handles
		// same-hash clicks itself), so links to this presentation are followed on click too. The hash is left
		// to the browser; a changed one also fires hashchange, where goTo to the same position is a no-op.
		document.addEventListener('click', (e) => {
			if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
			if (!(a instanceof HTMLAnchorElement)) return;
			const url = new URL(a.href);
			if (url.origin !== location.origin || url.pathname !== location.pathname) return;
			const ref = parseHash(url.hash, p);
			if (ref && ctl.goTo(ref)) root.scrollIntoView({ block: 'nearest' });
		}, { signal });
		document.addEventListener('fullscreenchange', () => {
			fsNative = document.fullscreenElement === root;
		}, { signal });

		root.addEventListener('keydown', onKeydown, { signal });
		root.addEventListener('focusin', onFocusin, { signal });
		stage.addEventListener('pointerdown', onPointerdown, { signal });
		stage.addEventListener('pointermove', onPointermove, { signal });
		stage.addEventListener('pointerup', onPointerup, { signal });
		stage.addEventListener('pointercancel', onPointercancel, { signal });

		return () => {
			listeners.abort();
			stopTheme();
			resize.disconnect();
			offChange();
			ctl.destroy();
			// The grid's own teardown runs its thumbnail cleanups; destroying the host also unmounts any left.
			slideHost.destroy();
			host = null;
			controller = null;
			delete el.presentation;
			if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
			setOverlay(false);
		};
	});

	const btn =
		'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 ' +
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40 ' +
		'disabled:hover:bg-transparent sm:min-h-9 sm:min-w-9 dark:text-gray-200 dark:hover:bg-gray-700';
</script>

<!-- A labelled <section> is a region (an explicit role="region" is flagged as redundant). The frame
     takes keys only while focused, so the region itself must be focusable. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
	bind:this={root}
	tabindex="0"
	aria-label={regionLabel}
	data-theme={explicitTheme ?? undefined}
	data-presentation={p.name}
	class="pres-root not-prose flex flex-col rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
	class:pres-fullscreen={fullscreen}
	class:fixed={fsOverlay}
	class:inset-0={fsOverlay}
	class:z-50={fsOverlay}
>
	<div bind:this={stage} class="pres-stage">
		<div
			bind:this={canvas}
			class="pres-canvas"
			style:transform="translate({offsetX}px, {offsetY}px) scale({scale})"
			style:visibility={scale > 0 ? null : 'hidden'}
		></div>
		{#if gridCreated && host}
			<div class="absolute inset-0" hidden={!gridOpen}>
				<PresentationGrid
					presentation={p}
					{host}
					current={pos}
					lang={uiLang}
					theme={uiTheme}
					open={gridOpen}
					onpick={pickFromGrid}
					onclose={() => setGrid(false)}
				/>
			</div>
		{/if}
	</div>

	<div class="pres-toolbar flex items-center justify-center gap-1 px-1 py-1 sm:gap-2">
		<button type="button" class={btn} disabled={atFirst} aria-label={t(uiLang, 'presentation.prev')} title={t(uiLang, 'presentation.prev')} onclick={() => toolbar('prev')}>
			<ArrowLeftOutline class="h-5 w-5" aria-hidden="true" />
		</button>
		<span class="min-w-24 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">{positionText}</span>
		<button type="button" class={btn} disabled={atLast} aria-label={t(uiLang, 'presentation.next')} title={t(uiLang, 'presentation.next')} onclick={() => toolbar('next')}>
			<ArrowRightOutline class="h-5 w-5" aria-hidden="true" />
		</button>
		<button type="button" class={btn} aria-pressed={gridOpen} aria-label={t(uiLang, 'presentation.grid')} title={t(uiLang, 'presentation.grid')} onclick={() => toolbar('grid')}>
			<GridOutline class="h-5 w-5" aria-hidden="true" />
		</button>
		<button
			type="button"
			class={btn}
			aria-label={t(uiLang, fullscreen ? 'presentation.exitFullscreen' : 'presentation.fullscreen')}
			title={t(uiLang, fullscreen ? 'presentation.exitFullscreen' : 'presentation.fullscreen')}
			onclick={() => toolbar('fullscreen')}
		>
			{#if fullscreen}
				<CompressOutline class="h-5 w-5" aria-hidden="true" />
			{:else}
				<ExpandOutline class="h-5 w-5" aria-hidden="true" />
			{/if}
		</button>
	</div>

	<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
</section>

<style>
	.pres-root {
		--pres-fg: var(--color-gray-900, #111827);
		--pres-bg: var(--color-white, #fff);
		--pres-muted: var(--color-gray-500, #6b7280);
		--pres-accent: var(--color-primary-600, #0d9488);
		--pres-accent2: var(--color-amber-500, #f59e0b);
		--pres-dim: var(--color-gray-300, #d1d5db);
	}
	/* Dark under the site's `.dark` ancestor; `data-theme` (the frame's env theme) wins when set via the API. */
	:global(.dark) .pres-root:not([data-theme='light']),
	.pres-root[data-theme='dark'] {
		--pres-fg: var(--color-gray-100, #f3f4f6);
		--pres-bg: var(--color-gray-900, #111827);
		--pres-muted: var(--color-gray-400, #9ca3af);
		--pres-accent: var(--color-primary-400, #2dd4bf);
		--pres-accent2: var(--color-amber-400, #fbbf24);
		--pres-dim: var(--color-gray-700, #374151);
	}

	.pres-stage {
		position: relative;
		overflow: hidden;
		aspect-ratio: 16 / 9;
		background: var(--pres-bg);
		/* Horizontal swipes reach the frame; vertical page scrolling and pinch zoom stay the browser's. */
		touch-action: pan-y pinch-zoom;
	}

	.pres-canvas {
		position: absolute;
		left: 0;
		top: 0;
		width: 1600px;
		height: 900px;
		transform-origin: 0 0;
		color: var(--pres-fg);
		background: var(--pres-bg);
		/* Fixed, not inherited from the page: `not-prose` doesn't reset the prose body's inherited size. */
		font-size: 32px;
		line-height: 1.4;
	}

	/* Hidden (inert) slide roots (and the thumbnail-capture root), the canvas's direct children, stay laid
	   out; nothing inside may show through, even with its own visibility. A visible slide's own inert
	   elements are left alone. */
	.pres-canvas > :global([inert] *) {
		visibility: hidden !important;
	}

	/* Fullscreen (native or the overlay fallback): the stage fills what the toolbar leaves, letterboxed. */
	.pres-fullscreen {
		width: 100%;
		height: 100%;
		background: var(--pres-bg);
	}
	.pres-fullscreen .pres-stage {
		flex: 1 1 auto;
		min-height: 0;
		aspect-ratio: auto;
	}
	.pres-fullscreen .pres-toolbar {
		background: var(--pres-bg);
	}
</style>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n/strings';
	import { gridMove } from './input';
	import { pick } from './localize';
	import type { DomSlideHost } from './slide-host';
	import type { Lang, NormalizedPresentation, Position, Theme } from './types';

	let {
		presentation,
		host,
		current,
		lang,
		theme,
		open = true,
		onpick,
		onclose
	}: {
		presentation: NormalizedPresentation;
		host: DomSlideHost;
		current: Position;
		lang: Lang;
		/** The frame's theme; image thumbnails are captured per theme. */
		theme: Theme;
		/** The grid stays mounted while closed; this is what scrolls and focuses it on (re)opening. */
		open?: boolean;
		onpick: (pos: Position) => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const CANVAS_W = 1600;

	let el: HTMLElement;
	// svelte-ignore state_referenced_locally
	let sel = $state<Position>({ ...current });
	let thumbW = $state(160);
	/** Image URLs per slide; `null` = the thumbnail function failed (label card instead). Absent = loading. */
	let images = $state<Record<number, string[] | null>>({});
	const requested = new Set<number>();
	const scale = $derived(thumbW / CANVAS_W);
	const rows = $derived(presentation.slides.map((s) => s.states.length));

	const thumbId = (p: Position) => `${uid}-${p.slide}-${p.state}`;
	const same = (a: Position, b: Position) => a.slide === b.slide && a.state === b.state;

	function slideTitle(s: number): string {
		const sl = presentation.slides[s];
		return sl.label !== undefined
			? pick(sl.label, lang)
			: (sl.name ?? t(lang, 'presentation.slide', { slide: s + 1 }));
	}

	function stateLabel(s: number, k: number): string | undefined {
		const l = presentation.slides[s].states[k]?.label;
		return l !== undefined ? pick(l, lang) : undefined;
	}

	function caption(s: number, k: number): string {
		return stateLabel(s, k) ?? presentation.slides[s].states[k]?.name ?? `${s + 1} · ${k + 1}`;
	}

	function loadImages(slide: number): void {
		if (requested.has(slide)) return;
		requested.add(slide);
		const l = lang;
		const th = theme;
		const current = () => l === lang && th === theme;
		host.thumbnailImages(slide).then(
			(urls) => { if (current()) images[slide] = urls; },
			// The host already logged the failure.
			() => { if (current()) images[slide] = null; }
		);
	}

	// A language or theme change invalidates image thumbnails (the host caches per lang and theme);
	// refetch those requested.
	// svelte-ignore state_referenced_locally
	let imagesKey = `${lang}|${theme}`;
	$effect(() => {
		const key = `${lang}|${theme}`;
		if (key === imagesKey) return;
		imagesKey = key;
		const again = [...requested];
		requested.clear();
		images = {};
		for (const s of again) loadImages(s);
	});

	// --- Lazy thumbnails -----------------------------------------------------------------------
	type Pending = { slide: number; state: number; cleanup?: () => void };
	const watched = new Map<Element, Pending>();
	let observer: IntersectionObserver | null = null;

	function reveal(node: Element, w: Pending): void {
		observer?.unobserve(node);
		const def = presentation.slides[w.slide].def;
		if (def.thumbnail === 'image') loadImages(w.slide);
		else if (def.thumbnail !== 'label') w.cleanup = host.mountInto(w.slide, node as HTMLElement, w.state, true);
	}

	/** Action: observes a thumbnail box; content is created when it first scrolls into view. */
	function lazy(node: HTMLElement, w: { slide: number; state: number }) {
		const entry: Pending = { ...w };
		watched.set(node, entry);
		if (observer) observer.observe(node);
		return {
			destroy() {
				observer?.unobserve(node);
				entry.cleanup?.();
				watched.delete(node);
			}
		};
	}

	onMount(() => {
		const mq = matchMedia('(min-width: 640px)');
		const syncWidth = () => { thumbW = mq.matches ? 160 : 120; };
		syncWidth();
		mq.addEventListener('change', syncWidth);

		observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const w = watched.get(e.target);
					if (e.isIntersecting && w) reveal(e.target, w);
				}
			},
			{ root: el, rootMargin: '200px' }
		);
		for (const node of watched.keys()) observer.observe(node);

		return () => {
			mq.removeEventListener('change', syncWidth);
			observer?.disconnect();
			observer = null;
			for (const w of watched.values()) {
				w.cleanup?.();
				w.cleanup = undefined;
			}
		};
	});

	// --- Opening: select the current position, scroll it into view, take focus ---------------------
	$effect(() => {
		if (!open) return;
		sel = { ...current };
		void tick().then(() => {
			if (!open) return;
			el.focus({ preventScroll: true });
			el.querySelector(`[id="${thumbId(current)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	});

	function onKeydown(e: KeyboardEvent): void {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			onpick({ ...sel });
		} else {
			const next = gridMove(sel, e.key, rows);
			if (next) {
				e.preventDefault();
				sel = next;
				el.querySelector(`[id="${thumbId(next)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			} else if (e.key.startsWith('Arrow') || e.key === ' ') {
				e.preventDefault();
			}
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={el}
	class="pres-grid"
	role="listbox"
	tabindex="-1"
	aria-label={t(lang, 'presentation.gridLabel')}
	aria-activedescendant={thumbId(sel)}
	onkeydown={onKeydown}
>
	{#each presentation.slides as slide, s (s)}
		<div class="pres-grid-row" role="group" aria-label={slideTitle(s)}>
			<div class="pres-grid-title">{s + 1}. {slideTitle(s)}</div>
			<div class="pres-grid-strip">
				{#each slide.states as _, k (k)}
					{@const at = { slide: s, state: k }}
					{@const kind = slide.def.thumbnail ?? 'live'}
					{@const url = kind === 'image' ? images[s]?.[k] : undefined}
					{@const asLabel = kind === 'label' || (kind === 'image' && (images[s] === null || (images[s] !== undefined && !url)))}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						id={thumbId(at)}
						class="pres-grid-cell"
						role="option"
						tabindex="-1"
						aria-selected={same(at, sel)}
						aria-current={same(at, current) ? 'true' : undefined}
						aria-label={caption(s, k)}
						style:width="{thumbW}px"
						onclick={() => onpick(at)}
					>
						<div class="pres-grid-thumb" class:sel={same(at, sel)} class:cur={same(at, current)} style:height="{(thumbW * 9) / 16}px">
							{#if asLabel}
								<div class="pres-grid-card">
									<span class="font-semibold">{slideTitle(s)}</span>
									{#if stateLabel(s, k)}<span class="opacity-70">{stateLabel(s, k)}</span>{/if}
								</div>
							{:else if kind === 'image'}
								{#if url}<img src={url} alt="" draggable="false" />{/if}
								<span class="pres-grid-probe" use:lazy={at}></span>
							{:else}
								<div
									class="pres-grid-live"
									style:transform="scale({scale})"
									use:lazy={at}
									aria-hidden="true"
									inert
								></div>
							{/if}
						</div>
						<div class="pres-grid-caption" class:font-semibold={same(at, current)}>{caption(s, k)}</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.pres-grid {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		background: var(--pres-bg);
		color: var(--pres-fg);
		touch-action: pan-x pan-y;
		outline: none;
	}
	.pres-grid-title {
		margin: 0.25rem 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--pres-muted);
	}
	.pres-grid-strip {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding: 4px 4px 6px;
	}
	.pres-grid-cell {
		flex: none;
		cursor: pointer;
	}
	.pres-grid-thumb {
		position: relative;
		overflow: hidden;
		border-radius: 0.25rem;
		border: 1px solid var(--pres-dim);
		background: var(--pres-bg);
	}
	.pres-grid-thumb.cur {
		border-color: var(--pres-accent);
		box-shadow: 0 0 0 2px var(--pres-accent);
	}
	/* The selection reads as a focus ring while the grid has focus. */
	.pres-grid-thumb.sel {
		outline: 2px solid var(--pres-accent2);
		outline-offset: 2px;
	}
	.pres-grid-live {
		position: absolute;
		left: 0;
		top: 0;
		width: 1600px;
		height: 900px;
		transform-origin: 0 0;
		pointer-events: none;
		/* The same fixed base as the frame's canvas, so a live thumbnail lays out like the slide. */
		font-size: 32px;
		line-height: 1.4;
	}
	.pres-grid-probe {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.pres-grid-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.pres-grid-card {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		line-height: 1.2;
	}
	.pres-grid-caption {
		margin-top: 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--pres-muted);
	}
</style>

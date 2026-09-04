<script lang="ts">
	/**
	 * Fullscreen media gallery: a Swiper deck of images, video clips and YouTube
	 * embeds with a thumbnail strip below. Callers hand it a flat item list and
	 * flip `open`; while shown it owns navigation, zoom, playback, focus and the
	 * body scroll lock, and it closes itself through the bound `open`.
	 *
	 * Swiper's JS is imported dynamically on first open, keeping it out of the
	 * initial bundle of pages that merely link to a gallery. Its CSS is imported
	 * statically, the way the hike page already pulls in Leaflet's stylesheet.
	 */
	import { untrack } from 'svelte';
	import type { GalleryItem } from '$lib/renderers/gallery-item';
	import type { Swiper as SwiperInstance } from 'swiper';
	import 'swiper/css';
	import 'swiper/css/navigation';
	import 'swiper/css/thumbs';
	import 'swiper/css/zoom';
	import 'swiper/css/free-mode';

	interface Props {
		items: GalleryItem[];
		open: boolean;
		/** Slide to show when opening. Read once per open, never written back. */
		index?: number;
	}

	let { items, open = $bindable(false), index = 0 }: Props = $props();

	let mainEl = $state<HTMLDivElement | null>(null);
	let thumbsEl = $state<HTMLDivElement | null>(null);
	let prevEl = $state<HTMLButtonElement | null>(null);
	let nextEl = $state<HTMLButtonElement | null>(null);
	let closeEl = $state<HTMLButtonElement | null>(null);

	/** Slide on screen. Drives the counter and which caption is shown. */
	let current = $state(0);
	/**
	 * True once Swiper exists and has positioned the deck on `index`.
	 */
	let ready = $state(false);
	/** Slides whose full resolution image has arrived, keyed by slide index. */
	let imageLoaded = $state<Record<number, boolean>>({});

	// Plain array: only ever read from event handlers, so it needs no reactivity.
	const videoEls: (HTMLVideoElement | null)[] = [];

	const caption = $derived(items[current]?.captionHtml ?? '');

	function close() {
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape' || event.key === 'Esc') {
			event.stopPropagation();
			close();
		}
	}

	/** Not every video has a maxres poster; fall back to the size that always exists. */
	function onPosterError(event: Event) {
		const img = event.currentTarget as HTMLImageElement;
		if (img.dataset.posterFallback) return;
		img.dataset.posterFallback = 'true';
		img.src = img.src.replace('/maxresdefault.jpg', '/hqdefault.jpg');
	}

	/**
	 * At most one slide plays at a time: the active one, and only when its clip
	 * carried the `autoplay` flag in markdown. Every other clip is paused and
	 * rewound, so nothing keeps playing on a slide the reader has left.
	 */
	function syncPlayback(activeIndex: number) {
		items.forEach((item, i) => {
			const el = videoEls[i];
			if (!el) return;
			if (i === activeIndex) {
				if (item.kind === 'video' && item.autoplay) {
					// Muting is what makes browser autoplay permissible at all.
					el.muted = true;
					void el.play().catch(() => {});
				}
				return;
			}
			el.pause();
			// Seeking a clip that never loaded its metadata throws in some browsers.
			if (el.readyState > 0) el.currentTime = 0;
		});
	}

	$effect(() => {
		if (!open || !mainEl) return;

		// Read once, untracked: the slide handlers below write `current`, and
		// tracking `index` would re-enter this effect and rebuild Swiper.
		const startIndex = untrack(() => index);
		const slideCount = untrack(() => items.length);
		// Set before the first paint so the counter and caption describe the slide
		// that was actually clicked, not slide 0.
		current = startIndex;
		ready = false;
		const restoreFocus = document.activeElement as HTMLElement | null;
		const mainNode = mainEl;
		const thumbsNode = thumbsEl;
		const navPrev = prevEl;
		const navNext = nextEl;

		document.body.style.overflow = 'hidden';
		closeEl?.focus();

		let cancelled = false;
		let main: SwiperInstance | undefined;
		let thumbs: SwiperInstance | undefined;

		(async () => {
			const [{ default: Swiper }, modules] = await Promise.all([
				import('swiper'),
				import('swiper/modules')
			]);
			if (cancelled) return;

			if (thumbsNode) {
				thumbs = new Swiper(thumbsNode, {
					modules: [modules.FreeMode, modules.A11y],
					slidesPerView: 'auto',
					spaceBetween: 8,
					freeMode: true,
					watchSlidesProgress: true,
					a11y: { enabled: true, containerMessage: 'Gallery thumbnails' }
				});
			}

			main = new Swiper(mainNode, {
				modules: [
					modules.Navigation,
					modules.Keyboard,
					modules.Mousewheel,
					modules.Zoom,
					modules.Thumbs,
					modules.A11y
				],
				initialSlide: startIndex,
				loop: slideCount > 1,
				slidesPerView: 1,
				spaceBetween: 24,
				lazyPreloadPrevNext: 1,
				navigation: { prevEl: navPrev, nextEl: navNext },
				keyboard: { enabled: true, onlyInViewport: false },
				mousewheel: { forceToAxis: true, thresholdDelta: 12 },
				zoom: { maxRatio: 3, panOnMouseMove: true },
				thumbs: thumbs ? { swiper: thumbs } : undefined,
				a11y: {
					enabled: true,
					prevSlideMessage: 'Previous item',
					nextSlideMessage: 'Next item'
				},
				on: {
					slideChange: (swiper) => {
						current = swiper.realIndex;
					},
					slideChangeTransitionEnd: (swiper) => syncPlayback(swiper.realIndex),
					// While zoomed in, the wheel should pan the image, not page the deck.
					zoomChange: (swiper, scale) => {
						if (scale > 1) swiper.mousewheel?.disable();
						else swiper.mousewheel?.enable();
					}
				}
			});

			current = main.realIndex;
			syncPlayback(main.realIndex);
			// The deck is on the right slide now, so it is safe to show.
			ready = true;
		})();

		return () => {
			cancelled = true;
			// `cleanStyles: false` - Svelte is about to drop this DOM anyway.
			main?.destroy(true, false);
			thumbs?.destroy(true, false);
			document.body.style.overflow = '';
			ready = false;
			imageLoaded = {};
			restoreFocus?.focus?.();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div
		class="mg-overlay"
		class:mg-ready={ready}
		role="dialog"
		aria-modal="true"
		aria-label="Media gallery"
	>
		<div class="mg-topbar">
			{#if items.length > 1}
				<span class="mg-counter" aria-live="polite">{current + 1} / {items.length}</span>
			{/if}
			<button
				bind:this={closeEl}
				type="button"
				class="mg-icon-button"
				aria-label="Close gallery"
				onclick={close}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path d="M6 6l12 12M18 6L6 18" />
				</svg>
			</button>
		</div>

		<div class="swiper mg-main" bind:this={mainEl}>
			<div class="swiper-wrapper">
				{#each items as item, i (i)}
					<div class="swiper-slide mg-slide">
						{#if item.kind === 'image'}
							{#if item.placeholder && !imageLoaded[i]}
								<!-- Blurred thumb holds the frame until the full image arrives. -->
								<img src={item.placeholder} alt="" aria-hidden="true" class="mg-placeholder" />
							{/if}
							<div class="swiper-zoom-container">
								<img
									src={item.src}
									alt={item.alt}
									title={item.title}
									class="mg-media"
									loading="lazy"
									onload={() => (imageLoaded[i] = true)}
								/>
							</div>
							<div class="swiper-lazy-preloader swiper-lazy-preloader-white"></div>
						{:else if item.kind === 'video'}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video
								bind:this={videoEls[i]}
								src={item.src}
								title={item.title}
								class="mg-media"
								controls
								loop
								playsinline
								preload="metadata"
							></video>
						{:else}
							<a
								class="mg-facade"
								href={item.href}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`Watch ${item.alt || 'video'} on YouTube (opens in a new tab)`}
							>
								<img
									src={`https://img.youtube.com/vi/${item.videoId}/maxresdefault.jpg`}
									alt=""
									class="mg-media"
									loading="lazy"
									onerror={onPosterError}
								/>
								<span class="mg-play-badge" aria-hidden="true">
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 4.5v15L18.5 12 5.5 4.5Z" /></svg>
								</span>
							</a>
							<div class="swiper-lazy-preloader swiper-lazy-preloader-white"></div>
						{/if}
					</div>
				{/each}
			</div>
			{#if !ready}
				<div class="swiper-lazy-preloader swiper-lazy-preloader-white"></div>
			{/if}
			<button bind:this={prevEl} type="button" class="swiper-button-prev mg-nav" aria-label="Previous item"></button>
			<button bind:this={nextEl} type="button" class="swiper-button-next mg-nav" aria-label="Next item"></button>
		</div>

		{#if caption}
			<div class="mg-caption">{@html caption}</div>
		{/if}

		{#if items.length > 1}
			<div class="swiper mg-thumbs" bind:this={thumbsEl}>
				<div class="swiper-wrapper">
					{#each items as item, i (i)}
						<div class="swiper-slide mg-thumb">
							{#if item.kind === 'image'}
								<img src={item.thumb ?? item.placeholder ?? item.src} alt="" loading="lazy" />
							{:else if item.kind === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -->
								<!-- The `#t=0.1` fragment makes browsers paint a real frame. -->
								<video src={`${item.src}#t=0.1`} preload="metadata" muted playsinline></video>
								<span class="mg-thumb-badge" aria-hidden="true">
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 4.5v15L18.5 12 5.5 4.5Z" /></svg>
								</span>
							{:else}
								<img src={`https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
								<span class="mg-thumb-badge" aria-hidden="true">
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 4.5v15L18.5 12 5.5 4.5Z" /></svg>
								</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* A photo viewer stays dark in both themes; the surrounding page theme would
	   otherwise wash out the images. Swiper's own colours are set through its
	   CSS custom properties. */
	.mg-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background-color: rgb(3 7 18 / 0.97);
		color: rgb(255 255 255 / 0.9);
		overscroll-behavior: contain;
		--swiper-theme-color: #fff;
		--swiper-navigation-color: #fff;
		--swiper-navigation-size: 30px;
		--swiper-navigation-sides-offset: 12px;
	}

	.mg-topbar {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
	}

	.mg-counter {
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.8);
	}

	.mg-icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		background-color: rgb(17 24 39 / 0.6);
		color: #fff;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.mg-icon-button:hover {
		background-color: rgb(17 24 39 / 0.95);
	}

	.mg-icon-button svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.mg-main {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
	}

	.mg-overlay:not(.mg-ready) .mg-main .swiper-wrapper,
	.mg-overlay:not(.mg-ready) .mg-nav,
	.mg-overlay:not(.mg-ready) .mg-thumbs {
		opacity: 0;
	}

	.mg-slide {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.mg-media {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.mg-slide video.mg-media {
		width: 100%;
		height: 100%;
	}

	.mg-placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: blur(8px);
		pointer-events: none;
	}

	.mg-facade {
		position: relative;
		display: flex;
		max-width: 100%;
		max-height: 100%;
		cursor: pointer;
	}

	/* The poster is decorative, so the link itself is the only pointer target. */
	.mg-facade img {
		pointer-events: none;
	}

	.mg-play-badge {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 4rem;
		height: 4rem;
		border-radius: 9999px;
		background-color: rgb(17 24 39 / 0.5);
		color: rgb(255 255 255 / 0.85);
		pointer-events: none;
		transition:
			background-color 150ms ease,
			transform 150ms ease;
	}

	.mg-facade:hover .mg-play-badge,
	.mg-facade:focus-visible .mg-play-badge {
		background-color: rgb(17 24 39 / 0.75);
		transform: translate(-50%, -50%) scale(1.08);
	}

	.mg-play-badge svg {
		width: 1.75rem;
		height: 1.75rem;
	}

	.mg-caption {
		flex: 0 0 auto;
		padding: 0.5rem 3rem;
		text-align: center;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.mg-caption :global(a) {
		color: rgb(147 197 253);
		text-decoration: underline;
	}

	.mg-thumbs {
		flex: 0 0 auto;
		width: 100%;
		padding: 0.5rem 0.75rem 0.75rem;
	}

	.mg-thumb {
		position: relative;
		width: 5rem;
		height: 3.5rem;
		flex-shrink: 0;
		border-radius: 0.375rem;
		overflow: hidden;
		cursor: pointer;
		opacity: 0.5;
		transition: opacity 150ms ease;
	}

	.mg-thumb:hover {
		opacity: 0.85;
	}

	.mg-thumb img,
	.mg-thumb video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.mg-thumb-badge {
		position: absolute;
		right: 0.15rem;
		bottom: 0.15rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 9999px;
		background-color: rgb(17 24 39 / 0.7);
		color: rgb(255 255 255 / 0.9);
		pointer-events: none;
	}

	.mg-thumb-badge svg {
		width: 0.6rem;
		height: 0.6rem;
	}

	/* Added by Swiper at runtime, so it never appears in the markup above. */
	.mg-thumbs :global(.swiper-slide-thumb-active) {
		opacity: 1;
		outline: 2px solid #fff;
		outline-offset: -2px;
	}

	@media (max-width: 640px) {
		.mg-thumb {
			width: 4rem;
			height: 3rem;
		}

		.mg-caption {
			padding: 0.35rem 1rem;
			font-size: 0.8125rem;
		}
	}
</style>

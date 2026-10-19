<script lang="ts">
	import { onMount } from 'svelte';
	import resume from '$lib/data/resume.json';
	import { heroNavItems } from '$lib/data/nav';
	import DarkModeButton from '$lib/components/DarkModeButton.svelte';
	import MountainOutline from '$lib/icons/MountainOutline.svelte';
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import { HERO_CANDIDATES_PLACEHOLDER, HERO_CANDIDATES_URL, type HeroCandidate } from '$lib/hikes/hero-map';
	import type { HeroLayout, HeroMapHandle } from '$lib/hero-map/scene';

	let { pastHero = $bindable(false) }: { pastHero?: boolean } = $props();

	// The text block drifts down at this fraction of the scroll, clipped by the hero.
	const PARALLAX = 0.9;

	let section: HTMLElement;
	let canvasHost: HTMLElement;
	let textBlock: HTMLElement;
	const labels: HTMLAnchorElement[] = [];
	const lines: SVGLineElement[] = [];
	const dots: SVGCircleElement[] = [];
	let ready = $state(false);
	let shown = $state<HeroCandidate>(); // the hike on the map, once it's drawn
	let reducedMotion = false;

	/** Px the text block is moved down by at this scroll position, whether CSS or the scroll handler moves it. */
	function drift(box: DOMRect): number {
		return reducedMotion ? 0 : Math.min(Math.max(0, -box.top), box.height) * PARALLAX;
	}

	// Picked before first paint by the inline script below, so the hike's files
	// download while the app and three.js are still loading.
	const bootScript = `<script>(function(){try{var c=JSON.parse(document.getElementById('hero-map-candidates').textContent);if(!c.length)return;var h=c[Math.floor(Math.random()*c.length)];document.documentElement.dataset.heroHike=h.slug;[h.heightmap,h.route].forEach(function(u){var l=document.createElement('link');l.rel='preload';l.as='fetch';l.crossOrigin='anonymous';l.href=u;document.head.appendChild(l);});}catch(e){}})();<\/script>`;

	/** Inlined by the server hook on a full load; fetched after client-side navigation, where the head holds the bare placeholder. */
	async function loadCandidates(): Promise<HeroCandidate[]> {
		try {
			return JSON.parse(document.getElementById('hero-map-candidates')?.textContent ?? '');
		} catch {
			const response = await fetch(HERO_CANDIDATES_URL);
			return response.ok ? response.json() : [];
		}
	}

	function layout(): HeroLayout {
		// Measured as if unscrolled: the scene adds the scroll shift itself, so the
		// camera fit (which depends on textBottom) doesn't change while scrolling.
		const box = section.getBoundingClientRect();
		const shift = drift(box);
		return {
			width: box.width,
			height: box.height,
			textBottom: textBlock.getBoundingClientRect().bottom - box.top - shift,
			anchors: labels.map((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top - shift };
			})
		};
	}

	onMount(() => {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		// Browsers with scroll-driven animations move the text block in CSS (see the styles), off the
		// main thread; the handler then only keeps the connector lines' label ends following it.
		const cssDrift = CSS.supports('animation-timeline: view()');
		const sizeObserver = new ResizeObserver(() => {
			section.style.setProperty('--hero-height', `${section.offsetHeight}px`);
		});
		sizeObserver.observe(section);
		let handle: HeroMapHandle | undefined;
		let destroyed = false;

		let scrollFrame = 0;
		const onScroll = () => {
			if (scrollFrame) return;
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = 0;
				const box = section.getBoundingClientRect();
				pastHero = box.bottom <= 0;
				if (reducedMotion) return;
				const shift = drift(box);
				if (!cssDrift) textBlock.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
				handle?.setAnchorShift(shift);
			});
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });

		let candidate: HeroCandidate | undefined;
		loadCandidates()
			.then((candidates) => {
				if (!candidates.length || destroyed) return;
				// The boot script only runs on a full page load; client-side navigation picks here.
				const chosen = document.documentElement.dataset.heroHike;
				candidate = candidates.find((c) => c.slug === chosen) ?? candidates[Math.floor(Math.random() * candidates.length)];
				return import('$lib/hero-map/scene');
			})
			.then((scene) => scene && candidate && scene.initHeroMap(canvasHost, candidate, { lines, dots }, layout, { reducedMotion }))
			.then((h) => {
				if (!h) return;
				if (destroyed) return h.destroy();
				handle = h;
				h.setAnchorShift(drift(section.getBoundingClientRect()));
				shown = candidate;
				ready = true;
			})
			.catch(() => {
				// No WebGL, or a file failed: the hero stays as the static text and labels.
			});

		return () => {
			destroyed = true;
			window.removeEventListener('scroll', onScroll);
			sizeObserver.disconnect();
			cancelAnimationFrame(scrollFrame);
			handle?.destroy();
		};
	});
</script>

<svelte:head>
	{@html `<script type="application/json" id="hero-map-candidates">${HERO_CANDIDATES_PLACEHOLDER}<\/script>`}
	{@html bootScript}
</svelte:head>

<section bind:this={section} class="hero-map relative isolate min-h-[100svh] overflow-hidden">
	<div
		bind:this={canvasHost}
		class="absolute inset-0 -z-10 transition-opacity duration-700 {ready ? 'opacity-100' : 'opacity-0'}"
		aria-hidden="true"
	></div>
	<svg
		class="pointer-events-none absolute inset-0 -z-10 h-full w-full transition-opacity duration-700 {ready ? 'opacity-100' : 'opacity-0'}"
		aria-hidden="true"
	>
		{#each heroNavItems as item, i (item.href)}
			<line bind:this={lines[i]} class="stroke-gray-500 dark:stroke-gray-400" stroke-width="1" stroke-dasharray="3 3" />
			<circle bind:this={dots[i]} r="4" class="fill-primary-600 stroke-white dark:stroke-gray-900" stroke-width="2" />
		{/each}
	</svg>

	<DarkModeButton class="absolute right-3 top-3 z-10" />

	{#if shown}
		<a
			href={shown.href}
			class="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-900 backdrop-blur transition-opacity duration-700 hover:border-primary-500 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-primary-600 dark:border-gray-700 dark:bg-gray-900/80 dark:text-white dark:hover:text-primary-400 {ready ? 'opacity-100' : 'opacity-0'}"
		>
			<MountainOutline class="h-4 w-4" aria-hidden="true" />
			{shown.name}
			<ArrowRightOutline class="h-4 w-4" aria-hidden="true" />
		</a>
	{/if}

	<div bind:this={textBlock} class="hero-text will-change-transform container mx-auto px-4 pt-16 md:px-24 md:pt-24">
		<h1 class="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl dark:text-white">{resume.basics.name}</h1>
		<p class="mt-4 max-w-2xl text-lg text-gray-700 dark:text-gray-300">{resume.basics.quote}</p>
		<nav aria-label="Site sections" class="mt-8">
			<ul class="flex flex-wrap gap-3">
				{#each heroNavItems as item, i (item.href)}
					<li>
						<a
							bind:this={labels[i]}
							href={item.href}
							class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-900 backdrop-blur hover:border-primary-500 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-primary-600 dark:border-gray-700 dark:bg-gray-900/80 dark:text-white dark:hover:text-primary-400"
						>
							<item.icon class="h-4 w-4" aria-hidden="true" />
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	</div>
</section>

<style>
	/* The text block drifts down by PARALLAX of the section's height while the section scrolls out
	   of view: 0 when its top leaves the viewport's top, the full drift when its bottom does. */
	@supports (animation-timeline: view()) {
		@media (prefers-reduced-motion: no-preference) {
			.hero-map {
				view-timeline: --hero-map block;
			}

			.hero-text {
				animation: hero-text-drift linear both;
				animation-timeline: --hero-map;
				animation-range: exit-crossing 0% exit-crossing 100%;
			}
		}
	}

	@keyframes hero-text-drift {
		from {
			transform: translate3d(0, 0, 0);
		}
		to {
			/* Keep in step with PARALLAX. */
			transform: translate3d(0, calc(var(--hero-height, 100svh) * 0.9), 0);
		}
	}
</style>

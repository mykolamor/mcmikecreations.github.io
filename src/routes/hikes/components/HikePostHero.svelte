<script lang="ts">
	// The hike post's hero: the header photo full width, the author top-start, a
	// card with the post's identity and calls to action bottom-start, and the stat
	// tiles along the photo's bottom edge. The tiles are one grid whose first row
	// (two on phones) sits on the photo; the rest follow below it, clipped until
	// "Show all". Every tile stays in the HTML.
	import { Button, A } from 'flowbite-svelte';
	import {
		ClockOutline,
		MapPinOutline,
		ArrowUpOutline,
		ArrowDownOutline,
		ArrowLeftOutline,
		HourglassOutline,
		UsersGroupOutline,
		ChartLineUpOutline,
		ChartLineDownOutline,
		ArrowsRepeatOutline,
		SortHorizontalOutline,
		FlagOutline,
		ShieldOutline,
		EyeOutline,
		FireOutline,
		CalendarMonthOutline,
		TruckOutline,
		ChevronDownOutline,
		ChevronUpOutline
	} from 'flowbite-svelte-icons';
	import { t, tSplit } from '$lib/i18n/strings';
	import { enumLabel } from '$lib/hikes/facts-format';
	import type { Lang } from '$lib/hikes/facts-schema';
	import type { HikeTile } from '$lib/hikes/hike-tiles';
	import { heroSizes } from '$lib/hikes/header-image';
	import type { ResponsivePicture } from '$lib/renderers/responsive-image';
	import StatTile from './StatTile.svelte';

	interface Props {
		lang: Lang;
		title: string;
		description?: string | null;
		author: string;
		/** The reading time, `data.post.time`. */
		readTime: string;
		/** YYYY-MM-DD. */
		date: string;
		updated: string | null;
		tags: string[];
		/** Slugs; plain chips until their hub pages exist. */
		regions: string[];
		categories: string[];
		allHikesLink: string;
		/** The 400px thumb: shown when there are no tiers, and to browsers without AVIF. */
		image?: string;
		imageFull?: string;
		/** The header image's AVIF tiers and blur (`pnpm crm images`). */
		picture: ResponsivePicture | null;
		onOpenImage: () => void;
		tiles: HikeTile[];
	}

	let {
		lang, title, description, author, readTime, date, updated, tags, regions, categories, allHikesLink,
		image, imageFull, picture, onOpenImage, tiles
	}: Props = $props();

	const ICONS: Record<HikeTile['icon'], typeof ClockOutline> = {
		distance: MapPinOutline,
		typical: UsersGroupOutline,
		ascent: ArrowUpOutline,
		descent: ArrowDownOutline,
		movingTime: ClockOutline,
		elapsed: HourglassOutline,
		highPoint: ChartLineUpOutline,
		lowPoint: ChartLineDownOutline,
		routeType: FlagOutline,
		'loop': ArrowsRepeatOutline,
		'out-and-back': SortHorizontalOutline,
		'point-to-point': FlagOutline,
		difficulty: ShieldOutline,
		exposure: EyeOutline,
		fitness: FireOutline,
		season: CalendarMonthOutline,
		carFree: TruckOutline
	};

	const [updatedBefore, updatedAfter] = $derived(tSplit(lang, 'post.updated', 'date'));
	const chipClass = 'px-2.5 py-0.5 rounded-sm text-sm';
	const tagClass = `${chipClass} bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-300 no-underline hover:bg-primary-200 dark:hover:bg-primary-800`;
	const plainChipClass = `${chipClass} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200`;

	let expanded = $state(false);
	/** Tiles below the visible rows. Unknown before the first measure, so the button renders in the prerendered HTML. */
	let hiddenCount = $state(-1);
	let grid = $state<HTMLElement>();
	const gridId = 'hike-tiles';

	// Which tiles sit below the rows shown over the photo: those are clipped (CSS)
	// and made inert while collapsed, so Tab never lands on a tile nobody sees.
	$effect(() => {
		const el = grid;
		const open = expanded;
		void tiles;
		if (!el) return;
		const wide = window.matchMedia('(min-width: 48rem)');
		const measure = () => {
			const items = [...el.children] as HTMLElement[];
			const rows = [...new Set(items.map((item) => item.offsetTop))].sort((a, b) => a - b);
			const visibleRows = wide.matches ? 1 : 2;
			let hidden = 0;
			for (const item of items) {
				const below = rows.indexOf(item.offsetTop) >= visibleRows;
				if (below) hidden++;
				item.inert = below && !open;
			}
			hiddenCount = hidden;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		wide.addEventListener('change', measure);
		return () => {
			observer.disconnect();
			wide.removeEventListener('change', measure);
		};
	});

	function viewRoute(event: MouseEvent) {
		const map = document.getElementById('hike-map');
		if (!map) return;
		event.preventDefault();
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		map.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
	}

	// Calendar dates (YYYY-MM-DD) parse as UTC midnight: formatting them in the
	// reader's zone would show the day before west of Greenwich.
	const formatDate = (value: string) =>
		new Date(value).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
</script>

<header class="hike-hero relative w-full">
	<div class="hike-hero-photo relative isolate overflow-hidden flex flex-col min-h-[85svh] md:min-h-[min(80svh,52rem)] {image || picture ? 'bg-gray-800' : 'bg-primary-800'}">
		<!-- The photo is decorative here: the h1 names the post, the button says what a click does. -->
		{#if picture}
			<!-- The blur paints at once; the tier the screen needs (the LCP image) loads eagerly and paints over it.
			     Never hidden until `onload`: one cached before hydration would never get it. -->
			<img src={picture.blur} alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-cover m-0 scale-105 blur-md" />
			<picture class="absolute inset-0 block w-full h-full m-0">
				<source type="image/avif" srcset={picture.srcset} sizes={heroSizes(picture.width, picture.height)} />
				<img
					src={image ?? picture.src}
					alt=""
					width={picture.width}
					height={picture.height}
					loading="eager"
					fetchpriority="high"
					decoding="async"
					class="relative w-full h-full object-cover m-0"
				/>
			</picture>
		{:else if image}
			<img src={image} alt="" fetchpriority="high" class="absolute inset-0 w-full h-full object-cover m-0" />
		{/if}
		{#if imageFull}
			<button
				type="button"
				aria-label={t(lang, 'post.expandImage')}
				onclick={onOpenImage}
				class="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-0 p-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 focus-visible:outline-hidden"
			></button>
		{/if}
		<div class="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-black/55 to-transparent"></div>
		<div class="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/60 to-transparent"></div>

		<div class="relative z-10 container mx-auto px-4 md:px-8 flex flex-col flex-1 pointer-events-none">
			<!-- Inset by the card's padding, so it lines up with the card's text. -->
			<div class="pt-5 md:pt-8 px-5 md:px-6 text-white text-lg font-medium drop-shadow-md">{author}</div>

			<div class="mt-auto pt-8 max-w-2xl pointer-events-auto rounded-xl p-5 md:p-6 shadow-lg bg-white/85 dark:bg-gray-900/80 backdrop-blur-md text-gray-900 dark:text-white">
				<div class="flex flex-row flex-wrap items-center gap-x-2 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
					<A href={allHikesLink} class="inline-flex items-center md:hidden">
						<ArrowLeftOutline class="w-4 h-4 me-1" />
						{t(lang, 'nav.backToAll')}
					</A>
					<nav aria-label={t(lang, 'post.pagePath')} class="hidden md:block">
						<!-- /hikes/, as in the JSON-LD trail; the title (its last crumb) is the heading below. -->
						<ol class="inline-flex items-center gap-2">
							<li><a class="hover:underline underline-offset-2" href="/">{t(lang, 'nav.home')}</a></li>
							<li class="inline-flex items-center gap-2">
								<span aria-hidden="true" class="text-gray-400 dark:text-gray-500">/</span>
								<a class="hover:underline underline-offset-2" href="/hikes/">{t(lang, 'nav.hikes')}</a>
							</li>
						</ol>
					</nav>
					<span aria-hidden="true">·</span>
					<span>{readTime}</span>
					<span aria-hidden="true">·</span>
					<a class="underline underline-offset-2 hover:decoration-2" href="/hikes/year/{date.slice(0, 4)}/"><time datetime={date}>{formatDate(date)}</time></a>
					{#if updated}
						<span aria-hidden="true">·</span>
						<span>{updatedBefore}<time datetime={updated}>{formatDate(updated)}</time>{updatedAfter}</span>
					{/if}
				</div>
				{#if tags.length || regions.length || categories.length}
					<div class="flex flex-row flex-wrap gap-2 mt-3" role="group" aria-label={t(lang, 'list.tagsLabel')}>
						{#each tags as tag (tag)}
							<a class={tagClass} href="/hikes/tag/{encodeURIComponent(tag)}/">{tag}</a>
						{/each}
						{#each regions as region (region)}
							<span class={plainChipClass}>{enumLabel(lang, 'region', region)}</span>
						{/each}
						{#each categories as category (category)}
							<span class={plainChipClass}>{enumLabel(lang, 'category', category)}</span>
						{/each}
					</div>
				{/if}
				<h1 class="mt-3 text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">{title}</h1>
				{#if description}
					<p class="mt-3 text-base md:text-lg text-gray-700 dark:text-gray-300">{description}</p>
				{/if}
				<div class="mt-5 flex flex-row flex-wrap gap-3">
					<Button href="#hike-map" onclick={viewRoute}>{t(lang, 'post.hero.viewRoute')}</Button>
					<Button href="/#contact" color="alternative">{t(lang, 'post.hero.contactAuthor')}</Button>
				</div>
			</div>
		</div>
	</div>

	<!-- Clicks between the tiles fall through to the photo (the gallery). -->
	<div class="hike-hero-strip relative z-10 container mx-auto px-4 md:px-8 flex flex-col md:flex-row gap-3 md:items-start pointer-events-none">
		<!-- Above the tiles on phones, so it stays on the photo; beside them from md. -->
		{#if hiddenCount !== 0}
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={gridId}
				onclick={() => (expanded = !expanded)}
				class="hike-hero-toggle pointer-events-auto self-end md:self-start md:order-last shrink-0 inline-flex items-center gap-1 px-4 rounded-lg bg-white/80 dark:bg-gray-900/75 backdrop-blur-md shadow-sm text-sm font-medium text-primary-700 dark:text-primary-400 hover:bg-white dark:hover:bg-gray-900 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-hidden"
			>
				<!-- Both labels share one cell, the inactive one invisible (and so out of
				     the accessible name): the button keeps the longer one's width in every
				     language, and the tiles beside it don't resize on toggle. -->
				<span class="grid text-center">
					<span class="col-start-1 row-start-1 {expanded ? 'invisible' : ''}">{t(lang, 'post.stats.showAll', { count: tiles.length })}</span>
					<span class="col-start-1 row-start-1 {expanded ? '' : 'invisible'}">{t(lang, 'post.stats.showLess')}</span>
				</span>
				{#if expanded}<ChevronUpOutline class="w-4 h-4" />{:else}<ChevronDownOutline class="w-4 h-4" />{/if}
			</button>
		{/if}
		<div
			bind:this={grid}
			id={gridId}
			class="hike-hero-grid flex-1 min-w-0 grid grid-cols-2 {expanded ? '' : 'overflow-hidden'}"
			class:collapsed={!expanded}
			class:measured={hiddenCount !== -1}
		>
			{#each tiles as tile (tile.key)}
				<StatTile variant="glass" icon={ICONS[tile.icon]} label={tile.label} value={tile.value} hint={tile.hint} href={tile.href} />
			{/each}
		</div>
	</div>
</header>

<style>
	/* The photo reserves room at its bottom for the strip's visible rows (and, on
	   phones, the toggle above them); the strip is pulled up into that room so the
	   photo's edge falls in the middle of the gap after the last visible row, and
	   rows past it continue on the page below the photo. */
	.hike-hero {
		--tile-h: 4.25rem;
		--gap: 0.75rem;
		--rows: 2;
		--toggle-h: 2.5rem;
		--visible: calc(var(--rows) * var(--tile-h) + (var(--rows) - 1) * var(--gap));
		--reserve: calc(var(--visible) + var(--gap) + var(--toggle-h));
	}
	@media (min-width: 48rem) {
		.hike-hero {
			--tile-h: 4.5rem;
			--rows: 1;
			--reserve: var(--visible);
		}
	}
	.hike-hero-photo {
		padding-bottom: calc(var(--reserve) + var(--gap) / 2 + 1rem);
	}
	.hike-hero-strip {
		margin-top: calc(-1 * (var(--reserve) + var(--gap) / 2));
	}
	.hike-hero-grid {
		gap: var(--gap);
		grid-auto-rows: var(--tile-h);
	}
	.hike-hero-grid > :global(*) {
		pointer-events: auto;
	}
	/* At most 5 columns: wide screens grow the tiles instead of adding a sixth. */
	@media (min-width: 48rem) {
		.hike-hero-grid {
			grid-template-columns: repeat(auto-fill, minmax(max(11rem, calc((100% - 4 * var(--gap)) / 5)), 1fr));
		}
	}
	/* Before the effect has measured (prerendered HTML, pre-hydration), keep the
	   tiles past the strip's best case out of the tab order; the effect's
	   `inert` takes over once it runs. */
	.hike-hero-grid.collapsed:not(.measured) > :global(:nth-child(n + 5)) {
		visibility: hidden;
	}
	@media (min-width: 48rem) {
		.hike-hero-grid.collapsed:not(.measured) > :global(:nth-child(n + 5)) {
			visibility: visible;
		}
		.hike-hero-grid.collapsed:not(.measured) > :global(:nth-child(n + 6)) {
			visibility: hidden;
		}
	}
	.hike-hero-grid.collapsed {
		max-height: var(--visible);
	}
	.hike-hero-toggle {
		height: var(--toggle-h);
	}
	@media (min-width: 48rem) {
		.hike-hero-toggle {
			height: var(--tile-h);
		}
	}
</style>

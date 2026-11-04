<script lang="ts">
	/* eslint-disable @typescript-eslint/ban-ts-comment */
	import type { PageData } from './$types';
	import { Breadcrumb, BreadcrumbItem, Heading, A } from 'flowbite-svelte';
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
		FlagOutline
	} from 'flowbite-svelte-icons';
	import ToTopButton from '$lib/components/ToTopButton.svelte';
	import MediaGallery from '$lib/components/MediaGallery.svelte';
	import type { GalleryItem } from '$lib/renderers/gallery-item';
	import { getDistance, getTime } from '$lib/hikes/build-statistics';
	import { onDestroy, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import 'leaflet/dist/leaflet.css';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import resume from '$lib/data/resume.json';
	import HikeJsonLd from '../components/HikeJsonLd.svelte';
	import { hikePostTitle } from '$lib/hikes/hikes-meta';
	import { t, tSplit } from '$lib/i18n/strings';
	import { enumLabel } from '$lib/hikes/facts-format';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import { parseMarkdown } from '$lib/hikes/hikes-info';
	import HikeContacts from '../components/HikeContacts.svelte';
	import HikeFactsTiles from '../components/HikeFactsTiles.svelte';
	import StatTile from '../components/StatTile.svelte';
	import HikeFactsSafety from '../components/HikeFactsSafety.svelte';
	import HikeFactsGuide from '../components/HikeFactsGuide.svelte';
	import HikePlaces from '../components/HikePlaces.svelte';
	import { placeDocAnchor } from '$lib/hikes/place-docs';
	import { initMap2d, type Map2dHandle } from '$lib/hikes/map-2d';
	import type { MapPhoto } from '$lib/hikes/map-utils';
	import { initElevationChart, type ElevationPhotoTick } from '$lib/hikes/map-elevation';
	import { photoStopsFromRecord } from '$lib/hikes/photo-stops';
	import { initMap3d, type Map3dHandle } from '$lib/hikes/map-3d';
	import { buildFactsOverlay, chartPins } from '$lib/hikes/facts-overlay';
	import { computeMetricScales } from '$lib/hikes/hike-metrics';
	import { attachPhotoPins } from '$lib/hikes/photo-pins-view';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const lang = 'en';

	const ROUTE_TYPE_ICONS = {
		'loop': ArrowsRepeatOutline,
		'out-and-back': SortHorizontalOutline,
		'point-to-point': FlagOutline
	};

	const DURATION_NOTES = {
		gpx: t(lang, 'post.notes.duration.gpx'),
		manual: t(lang, 'post.notes.duration.manual'),
		planner: t(lang, 'post.notes.duration.planner')
	};

	const ELAPSED_NOTES = {
		gpx: t(lang, 'post.notes.elapsed.gpx'),
		photos: t(lang, 'post.notes.elapsed.photos'),
		manual: t(lang, 'post.notes.elapsed.manual')
	};

	// The download line: "Grab the <GPX> or <GeoJSON> file and …", links in between.
	const [grabBefore, grabAfter] = tSplit(lang, 'post.files.grab', 'files');

	// A moving time equal to the elapsed time to the minute means no breaks were
	// detected; showing the same number twice would only confuse.
	const showElapsed = $derived(
		data.facts.elapsed != null && Math.abs(data.facts.elapsed.minutes - (data.map.properties.duration ?? 0)) > 1
	);
	let allHikesLink = $derived(data.post.page > 1 ? `/hikes/page/${data.post.page}/#${data.post.anchor}` : `/hikes/#${data.post.anchor}`);

	let fullResImageSrc = $state<string | undefined>(undefined);
	let fullImageLoaded = $state(false);

	let galleryOpen = $state(false);
	let galleryIndex = $state(0);

	// The header image takes slide 0 when the post has one, so the markdown items start one slide later.
	const headerOffset = $derived(data.post.imageFull ? 1 : 0);
	const galleryItems = $derived(buildGalleryItems());

	function buildGalleryItems(): GalleryItem[] {
		// The place docs' photos follow the post's own: their `data-media-index`
		// values continue where the post's stop (see the server load).
		const media = [...data.post.media, ...(data.places ?? []).flatMap((p) => p.media)];
		const full = data.post.imageFull;
		if (!full) return media;
		const header: GalleryItem = {
			kind: 'image',
			src: full,
			// The thumb doubles as the blurred stand-in while the full image loads.
			placeholder: data.post.image !== full ? data.post.image : undefined,
			alt: data.post.title
		};
		return [header, ...media];
	}

	function openGallery(slide: number) {
		galleryIndex = slide;
		galleryOpen = true;
	}

	function openHeaderImage() {
		// The full resolution image is fetched lazily and never on small screens,
		// so make sure its request is under way before slide 0 appears.
		if (data.post.imageFull && !fullResImageSrc) {
			fullResImageSrc = data.post.imageFull;
		}
		openGallery(0);
	}

	interface File {
		path: string;
		type: string;
	}
	const filePrimary: File = $derived({
		path: data.display.filePrimary,
		type: t(lang, 'post.files.geojson')
	});
	const fileGpx: File = $derived({
		path: data.display.fileGpx,
		type: t(lang, 'post.files.gpx')
	});

	// Handles to the currently-mounted 3D/2D maps, so a later navigation (or the
	// component unmounting) can dispose them instead of leaking a WebGL context
	// and a window resize listener per hike post visited.
	let map3dHandle: Map3dHandle | undefined;
	let map2dHandle: Map2dHandle | undefined;
	// Bumped on every navigation so a stale, still-in-flight setup from a post the
	// reader has already navigated away from can tell it's been superseded and
	// back off instead of racing the current one.
	let contentRunId = 0;
	// Listeners on elements Svelte keeps across navigations (the facts layer's
	// place links), dropped with the maps they point at.
	let listenerAbort: AbortController | undefined;
	/** A photo pin's "Show on map"; set once the maps exist, a no-op until then. */
	let showPinOnMap: ((lat: number, lon: number) => void) | undefined;
	// The same for the place docs' links and photos, wired before the maps load.
	let placesAbort: AbortController | undefined;

	function teardownContent() {
		listenerAbort?.abort();
		listenerAbort = undefined;
		// The old post's map is going away; the next one sets this again.
		showPinOnMap = undefined;
		placesAbort?.abort();
		placesAbort = undefined;
		map3dHandle?.destroy?.();
		map2dHandle?.destroy?.();
		map3dHandle = undefined;
		map2dHandle = undefined;
	}

	onDestroy(teardownContent);

	// SvelteKit reuses this component across client-side navigations between hike
	// posts (only `data` changes), so this can't be onMount - it has to rerun on
	// every navigation, not just the first, or the second post's images stay
	// unclickable and its 3D/2D map and elevation charts never appear.
	afterNavigate(async () => {
		const runId = ++contentRunId;
		teardownContent();

		// Delay loading of the full resolution image to allow other assets to finish loading first
		fullResImageSrc = undefined;
		fullImageLoaded = false;
		if (data.post.imageFull) {
			const scheduleFullImage = () => {
				setTimeout(() => {
					if (runId === contentRunId) fullResImageSrc = data.post.imageFull;
				}, 100);
			};
			// `load` only fires once per full page load, never again on a client-side
			// navigation, so on the second+ hike post the page is already complete.
			if (document.readyState === 'complete') {
				scheduleFullImage();
			} else {
				window.addEventListener('load', scheduleFullImage, { once: true });
				// Fallback in case window load already fired
				setTimeout(() => {
					if (runId === contentRunId && !fullResImageSrc) {
						fullResImageSrc = data.post.imageFull;
					}
				}, 1000);
			}
		}

		// Let Svelte finish applying this navigation's `{@html data.clientHtml}`
		// before touching the DOM it produced.
		await tick();

		const contentEl = document.getElementById('content');
		if (!contentEl) return;

		if (contentEl.children.length == 0) {
			if (!data.clientHtml) {
				const dateStr = data.post.date;
				const date = data.map.properties.dates.find((d: any) => d.date === dateStr);
				if (date && date.path) {
					const res = await fetch(date.path);
					if (runId !== contentRunId) return;
					if (res.ok) {
						const postRaw = await res.text();
						// @ts-ignore
						data.clientHtml = (await parseMarkdown(postRaw, data.post.tags, {
							stops: photoStopsFromRecord(data.post.photoStops),
							nodes: data.placeNodes,
							pinNodes: data.pinNodes,
							origin: data.origin,
							height: data.height,
							ownRefs: data.ownRefs,
							placeDocs: data.placeRefs,
							lang
						})).html;
					}
				}
			}

			// @ts-ignore
			contentEl.innerHTML = data.clientHtml;
		}

		// Only images open the gallery.
		const images = contentEl.querySelectorAll<HTMLImageElement>('img[data-media-index]');
		images.forEach((img) => {
			img.addEventListener('click', () => {
				const mediaIndex = Number(img.dataset.mediaIndex);
				if (Number.isInteger(mediaIndex)) openGallery(mediaIndex + headerOffset);
			});
		});

		// Place docs: Svelte renders (and may keep) their section, so its
		// listeners go with `placesAbort`. Their photos join the gallery; a link
		// to a doc (a mention of its name, the ⓘ after a reference, or `place:`
		// links) opens it first.
		placesAbort = new AbortController();
		const placesSignal = placesAbort.signal;
		document.querySelectorAll<HTMLImageElement>('[data-place-docs] img[data-media-index]').forEach((img) => {
			img.addEventListener('click', () => {
				const mediaIndex = Number(img.dataset.mediaIndex);
				if (Number.isInteger(mediaIndex)) openGallery(mediaIndex + headerOffset);
			}, { signal: placesSignal });
		});
		const openPlaceDoc = (slug: string | undefined) => {
			const details = slug ? document.getElementById(placeDocAnchor(slug)) : null;
			if (details instanceof HTMLDetailsElement) details.open = true;
			return details;
		};
		document.addEventListener('click', (event) => {
			const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-place-doc]');
			if (link) openPlaceDoc(link.dataset.placeDoc);
		}, { signal: placesSignal });
		// Arriving at `#place-<slug>`: open that doc and bring it into view.
		if (location.hash.startsWith('#place-')) {
			openPlaceDoc(decodeURIComponent(location.hash.slice('#place-'.length)))?.scrollIntoView();
		}
		// Pins on the post's and the place docs' photos. They don't need the
		// maps, so they come before them; only "Show on map" waits for those.
		const article = document.querySelector<HTMLElement>('article');
		if (article && data.pinNodes) {
			attachPhotoPins(article, data.pinNodes, { onShowOnMap: (lat, lon) => showPinOnMap?.(lat, lon), signal: placesSignal, lang });
		}

		const geojsonRes = await fetch(data.map.properties.filePath);
		if (runId !== contentRunId || !geojsonRes.ok) return;

		const geojson = await geojsonRes.json();
		if (runId !== contentRunId) return;

		// The 3D map, 2D map, and both elevation charts are no longer built here:
		// parseMarkdown already reserved their boxes (correct position, correct
		// aspect-ratio) as part of the HTML this content came from - server-
		// rendered on first load, and from every client-side re-parse alike. All
		// that's left is to find those mount points and populate them, so the
		// article never has widgets pop into existence and shove content down
		// after it's already been painted.
		const map3dEl = contentEl.querySelector<HTMLElement>('[data-hike-widget="map3d-mount"]');
		const map3dElevWrapper = contentEl.querySelector<HTMLElement>('[data-hike-widget="elev3d-mount"]');
		const map2dEl = contentEl.querySelector<HTMLElement>('[data-hike-widget="map2d-mount"]');
		const elevWrapper = contentEl.querySelector<HTMLElement>('[data-hike-widget="elev2d-mount"]');
		if (!map3dEl || !map3dElevWrapper || !map2dEl || !elevWrapper) return;

		const photos: MapPhoto[] = [];
		data.post.media.forEach((item, mediaIndex) => {
			if (item.kind === 'image' && item.location && item.placeholder) {
				photos.push({ ...item.location, blur: item.placeholder, alt: item.alt, mediaIndex });
			}
		});
		const onPhotoClick = (mediaIndex: number) => openGallery(mediaIndex + headerOffset);
		// Hazards, bailout points and water from the facts layer, on the charts and the 2D map.
		const routeCoords: number[][] = geojson?.features?.[0]?.geometry?.coordinates ?? [];
		const factsOverlay = buildFactsOverlay(
			data.authoredFacts,
			lang,
			routeCoords,
			routeCoords.length ? computeMetricScales(routeCoords, data.map.properties).distanceFactor : 1,
			(data.map.properties.nodes ?? []).map((n) => n.ref)
		);
		const newMap3dHandle = initMap3d(map3dEl, geojson, data.map, data.map.properties.nodes, photos, onPhotoClick, undefined, factsOverlay, lang);
		const newMap2dHandle = await initMap2d(map2dEl, geojson, data.map.properties.nodes, photos, onPhotoClick, factsOverlay, lang);

		if (runId !== contentRunId) {
			// A newer navigation started while these were being created: they were
			// never assigned to map3dHandle/map2dHandle, so teardownContent() above
			// won't reach them - dispose them directly instead of leaking.
			newMap3dHandle.destroy?.();
			newMap2dHandle.destroy?.();
			return;
		}
		map3dHandle = newMap3dHandle;
		map2dHandle = newMap2dHandle;

		let elev3dHandle: { setIndicator: (lat: number, lon: number, preferredDist?: number) => void; hideIndicator: () => void };
		let elev2dHandle: { setIndicator: (lat: number, lon: number, preferredDist?: number) => void; hideIndicator: () => void };

		const hideAllIndicators = () => {
			elev3dHandle?.hideIndicator();
			elev2dHandle?.hideIndicator();
			newMap2dHandle.hideIndicator?.();
			newMap3dHandle.hideIndicator?.();
		};

		const stops = Object.entries(data.post.photoStops ?? {});
		const photoTicks: ElevationPhotoTick[] = stops.flatMap(([index, stop]) =>
			stop.km != null ? [{ km: stop.km, mediaIndex: Number(index), alt: data.post.media[Number(index)]?.alt }] : []
		);

		const chartFacts = {
			bands: factsOverlay.bands,
			pins: chartPins(factsOverlay.pins),
			onPinClick: (pin: { lat: number; lon: number }) => showOnMap(pin.lat, pin.lon)
		};

		// Each chart updates the maps and the OTHER chart.
		elev3dHandle = initElevationChart(map3dElevWrapper, geojson, (lat, lon, ele, dist) => {
			newMap2dHandle.setIndicator(lat, lon);
			newMap3dHandle.setIndicator(lat, lon, ele);
			elev2dHandle?.setIndicator(lat, lon, dist);
		}, hideAllIndicators, data.map.properties, photoTicks, onPhotoClick, chartFacts, lang);
		elev2dHandle = initElevationChart(elevWrapper, geojson, (lat, lon, ele, dist) => {
			newMap2dHandle.setIndicator(lat, lon);
			newMap3dHandle.setIndicator(lat, lon, ele);
			elev3dHandle?.setIndicator(lat, lon, dist);
		}, hideAllIndicators, data.map.properties, photoTicks, onPhotoClick, chartFacts, lang);

		// A photo's caption line, or a place name that is one of the hike's
		// nodes, brings the 2D map into view, centered on it.
		const map2dWrapper = contentEl.querySelector<HTMLElement>('[data-hike-widget="map2d-wrapper"]');
		const showOnMap = (lat: number, lon: number) => {
			const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			map2dWrapper?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
			newMap2dHandle.focusPoint?.(lat, lon);
		};
		contentEl.querySelectorAll<HTMLElement>('[data-photo-stop]').forEach((button) => {
			button.addEventListener('click', () => {
				const stop = data.post.photoStops?.[Number(button.dataset.photoStop)];
				if (stop?.lat != null && stop.lon != null) showOnMap(stop.lat, stop.lon);
			});
		});
		// Place links in the prose and in the facts layer around it alike.
		listenerAbort = new AbortController();
		const { signal } = listenerAbort;
		document.querySelectorAll<HTMLAnchorElement>('article a.mk-place').forEach((link) => {
			link.addEventListener('click', (event) => {
				const lat = Number(link.dataset.placeLat);
				const lon = Number(link.dataset.placeLon);
				if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
				// Scroll smoothly ourselves instead of jumping to #hike-map.
				event.preventDefault();
				showOnMap(lat, lon);
			}, { signal });
		});
		showPinOnMap = showOnMap;
	});
</script>

<AppMeta
	title={hikePostTitle(data.post.title)}
	description={data.post.description ?? undefined}
	image={data.post.image}
	type="article"
	tags={data.post.tags}
	article-published_time="{data.post.date}T16:00:00+00:00"
	article-modified_time="{data.post.dateModified}T16:00:00+00:00"
	article-author={resume.basics.name}
	article-section={t(lang, 'meta.section')}
/>
<AppBreadcrumbs items={[
	{ name: t(lang, 'nav.home'), href: '/' },
	{ name: t(lang, 'nav.hikes'), href: '/hikes/' },
	{ name: data.post.title, href: `/hikes/${data.post.anchor}/` }
]} />
<HikeJsonLd
	variant="post"
	title={data.post.title}
	description={data.post.description ?? ''}
	image={data.post.image}
	date={data.post.date}
	dateModified={data.post.dateModified}
	author={data.post.author}
	tags={data.post.tags}
	anchor={data.post.anchor}
	distance={data.map.properties.distance}
	ascent={data.map.properties.ascent}
	descent={data.map.properties.descent}
	duration={data.map.properties.duration}
	facts={data.authoredFacts}
	routeType={data.authoredFacts?.route?.type ?? data.facts.routeType}
	highPoint={data.facts.highPoint}
	media={data.post.media}
	bounds={data.post.bounds}
	placeName={data.map.name}
/>

<div class="container mx-auto">
	<div class="mx-4 2xl:mx-0 md:px-24 mb-8">
		<article class="mx-auto">
			<div class="mx-auto prose dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-500 md:prose-lg lg:prose-xl min-h-80">
				<div class="mt-2 flex md:hidden">
					<A href={allHikesLink} class="inline-flex items-center">
						<ArrowLeftOutline class="w-5 h-5 me-2" />
						{t(lang, 'nav.backToAll')}
					</A>
				</div>
				<Breadcrumb aria-label={t(lang, 'post.pagePath')} class="mt-4 not-prose hidden md:flex">
					<BreadcrumbItem href="/" home>{t(lang, 'nav.home')}</BreadcrumbItem>
					<BreadcrumbItem href={allHikesLink}>{t(lang, 'nav.hikes')}</BreadcrumbItem>
					<BreadcrumbItem>{data.post.title}</BreadcrumbItem>
				</Breadcrumb>
				<Heading tag="h1" class="!mb-0 !mt-2">{data.post.title}</Heading>
				<div class="flex flex-row flex-wrap gap-2 !mt-2 !mb-4">
					<span>{data.post.author}</span>
					·
					<span>{data.post.time}</span>
					·
					<a class="underline underline-offset-2 hover:decoration-2 cursor-pointer" href="/hikes/year/{new Date(data.post.date).getFullYear()}/">{new Date(data.post.date).toLocaleDateString('en-us', { year:"numeric", month:"short", day:"numeric"})}</a>
					{#if data.post.tags?.length}
						·
						<div class="flex flex-row flex-wrap justify-end gap-2 items-center" aria-details="tags">
							<span aria-label={t(lang, 'list.tagsLabel')} class="sr-only"></span>
							{#each data.post.tags as tag}
								<a class="bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-300 px-2.5 py-0.5 rounded-sm no-underline hover:bg-primary-200 dark:hover:bg-primary-800" href="/hikes/tag/{encodeURIComponent(tag)}/">{tag}</a>
							{/each}
						</div>
					{/if}
				</div>
				<div>
					<div class="flex flex-col gap-4 md:gap-6 mb-6 not-prose w-full max-w-none">
						<div class="flex flex-col md:flex-row gap-6">
							{#if data.post.imageFull}
								<div class="relative w-full md:w-48 lg:w-[24rem] aspect-video md:aspect-auto m-0 shrink-0 rounded-lg md:rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
									<img src={data.post.image} alt={data.post.title} class="absolute inset-0 w-full h-full object-cover m-0 {fullImageLoaded ? 'opacity-0 delay-500' : 'opacity-100'} transition-opacity duration-1000" />
									{#if fullResImageSrc}
										<picture class="absolute inset-0 w-full h-full m-0">
											<source media="(min-width: 768px)" srcset={fullResImageSrc} />
											<img src={data.post.image} alt={data.post.title} class="w-full h-full object-cover m-0 transition-opacity duration-500 {fullImageLoaded ? 'opacity-100' : 'opacity-0'}" onload={() => fullImageLoaded = true} />
										</picture>
									{/if}
									<button
										type="button"
										aria-label={t(lang, 'post.expandImage')}
										onclick={openHeaderImage}
										class="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-0 p-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 focus-visible:outline-hidden"
									></button>
								</div>
							{/if}
							<div class="flex flex-row flex-wrap md:flex-col md:justify-center gap-4 w-full md:[&>*]:basis-auto md:[&>*]:grow-0">
								<StatTile icon={ClockOutline} label={t(lang, data.durationSource === 'planner' ? 'post.stats.plannerEstimate' : 'post.stats.movingTime') + '*'} value={getTime(data.map.properties.duration ?? 0)} />
								<StatTile icon={MapPinOutline} label={t(lang, 'post.stats.distance')} value={getDistance(data.map.properties.distance ?? 0)} />
								<StatTile icon={ArrowUpOutline} label={t(lang, 'post.stats.ascent')} value={getDistance(data.map.properties.ascent ?? 0)} />
								<StatTile icon={ArrowDownOutline} label={t(lang, 'post.stats.descent')} value={getDistance(data.map.properties.descent ?? 0)} />
							</div>
						</div>
						<div class="flex flex-col">
							<div class="flex flex-row flex-wrap gap-4 md:gap-6">
								{#if showElapsed && data.facts.elapsed}
									<StatTile icon={HourglassOutline} label={t(lang, 'post.stats.elapsed') + '**'} value={(data.facts.elapsed.source === 'photos' ? '≥ ' : '') + getTime(data.facts.elapsed.minutes)} />
								{/if}
								{#if data.facts.typicalDuration != null}
									<StatTile icon={UsersGroupOutline} label={t(lang, 'post.stats.typical') + '***'} value={'≈ ' + getTime(Math.round(data.facts.typicalDuration / 15) * 15)} />
								{/if}
								{#if data.facts.highPoint != null}
									<StatTile icon={ChartLineUpOutline} label={t(lang, 'post.stats.highPoint')} value={t(lang, 'units.m', { value: data.facts.highPoint })} />
								{/if}
								{#if data.facts.lowPoint != null}
									<StatTile icon={ChartLineDownOutline} label={t(lang, 'post.stats.lowPoint')} value={t(lang, 'units.m', { value: data.facts.lowPoint })} />
								{/if}
								{#if data.facts.routeType}
									<StatTile icon={ROUTE_TYPE_ICONS[data.facts.routeType]} label={t(lang, 'post.stats.routeType')} value={enumLabel(lang, 'routeType', data.facts.routeType)} />
								{/if}
								{#if data.authoredFacts}
									<HikeFactsTiles facts={data.authoredFacts} {lang} />
								{/if}
							</div>
							<div class="text-sm text-gray-500 dark:text-gray-400 mt-2 flex flex-col gap-1">
								<span>* {DURATION_NOTES[data.durationSource]}</span>
								{#if showElapsed && data.facts.elapsed}
									<span>** {ELAPSED_NOTES[data.facts.elapsed.source]}</span>
								{/if}
								{#if data.facts.typicalDuration != null}
									<span>*** {t(lang, 'post.notes.typical')}</span>
								{/if}
							</div>
							{#if data.display.filePrimary || data.display.fileGpx}
								<blockquote class="!mb-0 mt-4 border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 italic text-gray-600 dark:text-gray-400">
									{grabBefore}{#if data.display.fileGpx && data.display.filePrimary}
										<A href={fileGpx.path} download={fileGpx.path.substring(fileGpx.path.lastIndexOf('/') + 1)}>{fileGpx.type}</A>
										{t(lang, 'post.files.or')}
									{:else if data.display.fileGpx}
										<A href={fileGpx.path} download={fileGpx.path.substring(fileGpx.path.lastIndexOf('/') + 1)}>{fileGpx.type}</A>
									{/if}
									{#if data.display.filePrimary}
										<A href={filePrimary.path} download={filePrimary.path.substring(filePrimary.path.lastIndexOf('/') + 1)}>{filePrimary.type}</A>
									{/if}{grabAfter}
								</blockquote>
							{/if}
						</div>
					</div>
					{#if data.authoredFacts}
						<HikeFactsSafety facts={data.authoredFacts} {lang} />
					{/if}
					<div id="content">
						{@html data.clientHtml ?? '%%SSR_POST_CONTENT%%'}
					</div>
					{#if data.places?.length}
						<HikePlaces places={data.places} {lang} />
					{/if}
					{#if data.authoredFacts}
						<HikeFactsGuide facts={data.authoredFacts} {lang} linkedPosts={data.linkedPosts} />
					{/if}
					<HikeContacts contacts={data.contacts} {lang} />
				</div>
			</div>
		</article>
	</div>
</div>

<MediaGallery
	items={galleryItems}
	bind:open={galleryOpen}
	index={galleryIndex}
	pinNodes={data.pinNodes}
	{lang}
	onShowOnMap={(lat, lon) => {
		// The gallery has closed by now, but the page only scrolls again once its cleanup has run.
		void tick().then(() => showPinOnMap?.(lat, lon));
	}}
/>

<ToTopButton />

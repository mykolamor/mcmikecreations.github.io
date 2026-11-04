<script lang="ts">
	/* eslint-disable svelte/no-at-html-tags */
	import type { PageData } from './$types';
	import { onMount } from "svelte";
	import { page } from '$app/state';
	import AppNavbar from "$lib/components/AppNavbar.svelte";
	import { Heading } from 'flowbite-svelte';
	import ShowcaseGrid from "./components/ShowcaseGrid.svelte";
	import ShowcaseTile from "./components/ShowcaseTile.svelte";
	import { A, P, ImagePlaceholder, CardPlaceholder, Progressbar } from 'flowbite-svelte';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import Footsteps from './components/Footsteps.svelte';
	import Hero from './components/Hero.svelte';
	import HikeList from './components/HikeList.svelte';
	import CustomPagination from './components/CustomPagination.svelte';
	import Feeds from './components/Feeds.svelte';
	import YearsNav from './components/YearsNav.svelte';
	import resume from '$lib/data/resume.json';
	import HikeJsonLd from './components/HikeJsonLd.svelte';
	import { HIKES_BLOG_TITLE, HIKES_BLOG_DESCRIPTION, HIKES_HERO_IMAGE } from '$lib/hikes/hikes-meta';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import { paragraphTexts, t } from '$lib/i18n/strings';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let posts = $derived(data.posts);
	let yearList = $derived(data.yearList);
	let showProgressbar = $derived(data.showProgressbar);

	// Shown as text, one `<p>` each, so the prerendered HTML has no `{@html}` markers.
	const webText = paragraphTexts('en', 'showcase.web.text');
	const climbText = paragraphTexts('en', 'showcase.climb.text');

	const imagesToLoad = 6;
	let loadedImages = $state(0);
	const heroImages = [
		"/images/hikes/hero/hike_poster_4_bg_2.png",
		"/images/hikes/hero/hike_poster_4.png",
		"/images/hikes/hero/hike_poster_3.png",
		"/images/hikes/hero/hike_poster_2.png",
		"/images/hikes/hero/hike_poster_0.png",
		"/images/hikes/hero/hike_poster_1.png"
	];

	onMount(() => {
		if (showProgressbar) {
			const progressbar = document.getElementById('progressbar');
			heroImages.map(src => {
				const bgImage = new Image();
				bgImage.onload = function() {
					loadedImages += 1;
					if (loadedImages >= imagesToLoad && progressbar) {
						setTimeout(() => {
							progressbar.classList.add('hide');
						}, 150);
					}
				};
				bgImage.src = src;
				return bgImage;
			});
		}

		const fakeHeader = document.getElementById('fake-header');
		function fakeHeaderColor() {
            const scrollY = window.scrollY;
            const windowHeight = window.innerHeight;
            if (fakeHeader) {
                if (scrollY >= windowHeight) {
                    fakeHeader.style.opacity = '0%';
                } else {
                    fakeHeader.style.opacity = '100%';
                }
            }
        }
		fakeHeaderColor();

		window.addEventListener('scroll', () => {
			fakeHeaderColor();
		});
	});
</script>

{#snippet title()}
    <span class="self-center whitespace-nowrap text-xl font-semibold invisible">Mykola Morozov</span>
{/snippet}

<AppMeta
	title={HIKES_BLOG_TITLE}
	description={HIKES_BLOG_DESCRIPTION}
	type="website"
	image={page.url.origin + HIKES_HERO_IMAGE}
	article-author={resume.basics.name}
	article-section={t('en', 'meta.section')}
/>
<HikeJsonLd variant="blog" posts={data.posts} currentPage={data.pagination.currentPage} totalPages={data.pagination.totalPages} />
<AppBreadcrumbs items={[{ name: t('en', 'nav.home'), href: '/' }, { name: t('en', 'nav.hikes'), href: '/hikes/' }]} />

<AppNavbar
    class="fixed z-50 top-0"
    bgClass="bg-white/50 dark:bg-gray-800/50 dark:text-white"
    bgClassUl="backdrop-blur-md bg-white dark:bg-gray-800 md:bg-white/50 md:dark:bg-gray-800/50 text-black dark:text-white"
    {title}
    fillNarrow={true}
    shouldFixNavbar="true"
    alwaysBurger={true}
/>
<Hero />
<Footsteps />
<div class="w-full h-[60px] bg-white dark:bg-gray-800 sticky top-0 z-40">
    <div id="fake-header" class="transition-all duration-300 absolute z-10 w-full h-full top-0 left-0 bg-white dark:bg-gray-900"></div>
    <div class="mx-auto h-full px-2 py-2.5 sm:px-4 flex flex-wrap items-center justify-between container">
        <a href="/" class="flex items-center">
            <span class="self-center whitespace-nowrap text-xl font-semibold dark:text-white">
                Mykola Morozov
            </span>
        </a>
    </div>
</div>

<section id="projects" class="container mx-auto my-8 scroll-my-20">
    <div class="mx-4 2xl:mx-0 md:px-24 mb-8">
        <Heading tag="h2">{t('en', 'home.projects')}</Heading>
        <div class="mt-8">
            <ShowcaseGrid>
                <ShowcaseTile x={2} y={1} href="/hikes/tag/Web/" img="/images/hikes/hero/web.jpg" alt={t('en', 'showcase.web.alt')} title={t('en', 'showcase.web.title')}>
                    <p>{webText[0]}</p>
                    <p>{webText[1]}</p>
                    <p>{webText[2]}</p>
                    <p>{webText[3]}</p>
                </ShowcaseTile>
                <ShowcaseTile href="/hikes/tag/Climb/" img="/images/hikes/hero/viaferrata.jpg" alt={t('en', 'showcase.climb.alt')} title={t('en', 'showcase.climb.title')}>
                    <p>{climbText[0]}</p>
                    <p>{climbText[1]}</p>
                </ShowcaseTile>
            </ShowcaseGrid>
        </div>
    </div>
</section>

<section id="blog" class="container mx-auto mb-8 scroll-my-20">
	<div class="mx-4 2xl:mx-0 md:px-24 mb-8">
		<Heading tag="h2">{t('en', 'home.blog')}</Heading>
		<div class="mt-8">
			<YearsNav years={yearList} />
		</div>
		<div class="mt-8">
			<main>
				<HikeList posts={posts} showPeople={data.showPeople} />
				<CustomPagination
					currentPage={data.pagination.currentPage}
					totalPages={data.pagination.totalPages}
					baseUrl="/hikes"
				/>
			</main>
		</div>
	</div>
</section>

<Feeds />

{#if showProgressbar}
	<div id="progressbar" class="fixed w-full h-full top-0 left-0 z-20 overflow-hidden bg-white dark:bg-gray-800">
		<div class="container mx-auto mt-10">
			<div class="mx-4 2xl:mx-0 md:px-24">
				<ImagePlaceholder size="md" class="mb-8" />
				<noscript>
					<P>{t('en', 'home.enableJs')}</P>
				</noscript>
				<Progressbar progress={Math.round(loadedImages / imagesToLoad * 100)} />
				<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 justify-items-stretch my-8">
					<CardPlaceholder />
					<CardPlaceholder class="hidden lg:block" />
					<CardPlaceholder class="hidden xl:block" />
				</div>
				<ImagePlaceholder size="sm" />
				<ImagePlaceholder size="sm" class="my-8" />
			</div>
		</div>
	</div>
{/if}

<style>
	#progressbar {
		opacity: 1;
		visibility: visible;
		transition: opacity 0.5s ease-in-out;
		pointer-events: none;
	}

  :global(#progressbar.hide) {
		opacity: 0;
		visibility: hidden;
		transition: opacity 0.5s ease-in-out, visibility 0s 0.5s;
  }
</style>

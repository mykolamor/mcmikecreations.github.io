<script lang="ts">
	import { Heading } from 'flowbite-svelte';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import type { PageData } from './$types';
	import HikeTagPage from '../../components/HikeTagPage.svelte';
	import HikesWeb from '../../components/HikesWeb.svelte';
	import HikeJsonLd from '../../components/HikeJsonLd.svelte';
	import { hikesTagTitle, hikesTagDescription, tagLabel, tagStrings } from '$lib/hikes/hikes-meta';
	import resume from '$lib/data/resume.json';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import { t, tSplit } from '$lib/i18n/strings';

	interface Props {
			data: PageData;
	}

	let { data }: Props = $props();
	let posts = $derived(data.posts);
	let pagination = $derived(data.pagination);
	let showPeople = $derived(data.showPeople);
	let tag = $derived(data.tag);

	// A tag with its own strings (`tags.<Tag>`) has its own title, description and breadcrumb.
	let own = $derived(tagStrings('en', tag));
	let jsonLdName = $derived(own?.title);
	let jsonLdDescription = $derived(own?.description);
	let breadcrumbName = $derived(own?.breadcrumb ?? tagLabel('en', tag));
	let appMetaTitle = $derived(own?.title ?? hikesTagTitle(tag, pagination.currentPage));
	let appMetaDescription = $derived(own?.description ?? hikesTagDescription(tag, pagination.currentPage));
</script>

<AppMeta
	title={appMetaTitle}
	description={appMetaDescription}
	type="website"
	article-author={resume.basics.name}
	article-section={t('en', 'meta.section')}
/>
<HikeJsonLd variant="tag" {tag} {posts} currentPage={pagination.currentPage} totalPages={pagination.totalPages} name={jsonLdName} description={jsonLdDescription} />
<AppBreadcrumbs items={[
	{ name: t('en', 'nav.home'), href: '/' },
	{ name: t('en', 'nav.hikes'), href: '/hikes/' },
	{ name: breadcrumbName, href: `/hikes/tag/${encodeURIComponent(tag)}/` }
]} />

{#if tag === 'Web'}
	<HikeTagPage {posts} {pagination} {showPeople} {tag}>
		<HikesWeb webData={data.webData!} />
	</HikeTagPage>
{:else if tag === 'Climb'}
	<HikeTagPage {posts} {pagination} {showPeople} {tag}>
		{@const [before, after] = tSplit('en', 'tags.Climb.intro', 'tag')}
		<Heading tag="h2" class="mb-2">{t('en', 'tags.Climb.heading')}</Heading>
		<p class="mb-8 text-gray-600 dark:text-gray-300">
			{before}<span class="font-medium">{tagLabel('en', tag)}</span>{after}
		</p>
	</HikeTagPage>
{:else}
	<HikeTagPage {posts} {pagination} {showPeople} {tag} />
{/if}

<script lang="ts">
    import { Heading, A } from 'flowbite-svelte';
    import { ArrowLeftOutline } from 'flowbite-svelte-icons';
    import HikeList from '../../../../components/HikeList.svelte';
    import CustomPagination from '../../../../components/CustomPagination.svelte';
    import AppMeta from '$lib/components/AppMeta.svelte';
    import type { PageData } from './$types';
		import Feeds from '../../../../components/Feeds.svelte';
		import YearsNav from '../../../../components/YearsNav.svelte';
		import HikeJsonLd from '../../../../components/HikeJsonLd.svelte';
		import { hikesYearTitle, hikesYearDescription } from '$lib/hikes/hikes-meta';
		import resume from '$lib/data/resume.json';
		import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
		import { t } from '$lib/i18n/strings';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();
    let posts = $derived(data.posts);
		let yearList = $derived(data.yearList);
    let pagination = $derived(data.pagination);
    let showPeople = $derived(data.showPeople);
    let year = $derived(data.year);
</script>

<AppMeta
	title={hikesYearTitle(year, pagination.currentPage)}
	description={hikesYearDescription(year, pagination.currentPage)}
	type="website"
	article-author={resume.basics.name}
	article-section={t('en', 'meta.section')}
/>
<HikeJsonLd variant="year" {year} {posts} currentPage={pagination.currentPage} totalPages={pagination.totalPages} />
<AppBreadcrumbs items={[
	{ name: t('en', 'nav.home'), href: '/' },
	{ name: t('en', 'nav.hikes'), href: '/hikes/' },
	{ name: String(year), href: `/hikes/year/${year}/` },
	{ name: t('en', 'nav.page', { page: pagination.currentPage }) }
]} />

<div class="h-[60px] md:h-[72px] bg-white dark:bg-gray-800 mb-8"></div>

<section class="container mx-auto mb-8">
	<div class="mx-4 2xl:mx-0 md:px-24 mb-8">
		<div class="mb-6">
			<A href="/hikes/#blog" class="inline-flex items-center">
				<ArrowLeftOutline class="w-5 h-5 me-2" />
				{t('en', 'nav.backToAll')}
			</A>
		</div>
		<Heading tag="h2" class="mb-8">{t('en', 'list.year', { year, page: pagination.currentPage })}</Heading>
		<div class="mt-8">
			<YearsNav years={yearList} />
		</div>
		<div class="mt-8">
			<HikeList {posts} {showPeople} />
			<CustomPagination
				currentPage={pagination.currentPage}
				totalPages={pagination.totalPages}
				baseUrl={`/hikes/year/${year}`}
			/>
		</div>
	</div>
</section>

<Feeds />

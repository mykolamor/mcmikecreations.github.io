<script lang="ts">
		import { A, Heading } from 'flowbite-svelte';
    import HikeList from '../../components/HikeList.svelte';
    import CustomPagination from '../../components/CustomPagination.svelte';
    import AppMeta from '$lib/components/AppMeta.svelte';
    import type { PageData } from './$types';
		import { ArrowLeftOutline } from 'flowbite-svelte-icons';
		import Feeds from '../../components/Feeds.svelte';
		import HikeJsonLd from '../../components/HikeJsonLd.svelte';
		import { hikesListTitle, hikesListDescription } from '$lib/hikes/hikes-meta';
		import resume from '$lib/data/resume.json';
		import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
		import { t } from '$lib/i18n/strings';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();
    let posts = $derived(data.posts);
    let pagination = $derived(data.pagination);
    let showPeople = $derived(data.showPeople);
</script>

<AppMeta
	title={hikesListTitle(pagination.currentPage)}
	description={hikesListDescription(pagination.currentPage)}
	type="website"
	article-author={resume.basics.name}
	article-section={t('en', 'meta.section')}
/>
<HikeJsonLd variant="list" {posts} currentPage={pagination.currentPage} />
<AppBreadcrumbs items={[
	{ name: t('en', 'nav.home'), href: '/' },
	{ name: t('en', 'nav.hikes'), href: '/hikes/' },
	{ name: t('en', 'nav.page', { page: pagination.currentPage }) }
]} />


<div class="h-[60px] md:h-[72px] bg-white dark:bg-gray-800 mb-8"></div>

<section class="container mx-auto mb-8">
	<div class="mx-4 2xl:mx-0 md:px-24 mb-8">
		<div class="mb-6">
			<A href="/hikes/" class="inline-flex items-center">
				<ArrowLeftOutline class="w-5 h-5 me-2" />
				{t('en', 'nav.backToAll')}
			</A>
		</div>
		<Heading tag="h2" class="mb-8">{t('en', 'list.allPage', { page: pagination.currentPage })}</Heading>
		<div class="mt-8">
            <HikeList {posts} {showPeople} />
            <CustomPagination
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                baseUrl="/hikes"
            />
		</div>
	</div>
</section>

<Feeds />

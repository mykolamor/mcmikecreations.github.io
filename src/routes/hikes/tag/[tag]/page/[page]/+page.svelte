<script lang="ts">
	import AppMeta from '$lib/components/AppMeta.svelte';
	import type { PageData } from './$types';
	import HikeTagPage from '../../../../components/HikeTagPage.svelte';
	import HikeJsonLd from '../../../../components/HikeJsonLd.svelte';
	import { hikesTagTitle, hikesTagDescription, tagLabel } from '$lib/hikes/hikes-meta';
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
    let tag = $derived(data.tag);
</script>

<AppMeta
	title={hikesTagTitle(tag, pagination.currentPage)}
	description={hikesTagDescription(tag, pagination.currentPage)}
	type="website"
	article-author={resume.basics.name}
	article-section={t('en', 'meta.section')}
/>
<HikeJsonLd variant="tag" {tag} {posts} currentPage={pagination.currentPage} totalPages={pagination.totalPages} />
<AppBreadcrumbs items={[
	{ name: t('en', 'nav.home'), href: '/' },
	{ name: t('en', 'nav.hikes'), href: '/hikes/' },
	{ name: tagLabel('en', tag), href: `/hikes/tag/${encodeURIComponent(tag)}/` },
	{ name: t('en', 'nav.page', { page: pagination.currentPage }) }
]} />

<HikeTagPage {posts} {pagination} {showPeople} {tag} />

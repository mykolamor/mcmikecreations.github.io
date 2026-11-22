<script lang="ts">
	import AppMeta from '$lib/components/AppMeta.svelte';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import AppJsonLd from '$lib/components/AppJsonLd.svelte';
	import TechTreeTimeline from '$lib/tech-tree/TechTreeTimeline.svelte';
	import { t } from '$lib/i18n/strings';
	import type { Lang } from '$lib/i18n/languages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const lang: Lang = 'en';
	const title = t(lang, 'techTree.title');
	const description = t(lang, 'techTree.description');
	const route = '/projects/smackdb/';
</script>

<AppMeta {title} {description} type="website" />
<AppBreadcrumbs items={[{ name: t(lang, 'nav.home'), href: '/' }, { name: 'Projects', href: '/projects/' }, { name: title, href: route }]} />
<AppJsonLd variant="collection" name={title} {description} url={route} items={data.published} />

<!-- min-w-0: the projects layout makes <main> a flex item, which would otherwise grow to the widest timeline. -->
<main class="flex-1 min-w-0 mx-4 2xl:mx-0">
	<h1 class="text-4xl font-extrabold mb-4 text-gray-900 dark:text-white">{title}</h1>
	<p class="mb-8 text-lg text-gray-600 dark:text-gray-300 max-w-3xl">{description}</p>
	{#each data.timelines as layout (layout.key)}
		<TechTreeTimeline {layout} {lang} />
	{:else}
		<p class="text-gray-500 dark:text-gray-400">{t(lang, 'techTree.empty')}</p>
	{/each}
</main>

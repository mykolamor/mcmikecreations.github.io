<script lang="ts">
	import { A, Heading } from 'flowbite-svelte';
	import { ArrowLeftOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import type { ProcessedPost } from '$lib/hikes/hikes-info';
	import HikeList from './HikeList.svelte';
	import CustomPagination from './CustomPagination.svelte';
	import Feeds from './Feeds.svelte';
	import { tagLabel } from '$lib/hikes/hikes-meta';
	import { t, tSplit } from '$lib/i18n/strings';

	interface Pagination {
		currentPage: number;
		totalPages: number;
	}

	interface Props {
		posts: ProcessedPost[];
		pagination: Pagination;
		showPeople?: boolean;
		tag: string;
		children?: Snippet;
	}

	let { posts, pagination, showPeople = false, tag, children }: Props = $props();
	let label = $derived(tagLabel('en', tag));
	const [taggedBefore, taggedAfter] = tSplit('en', 'list.tagged', 'tag');
</script>

<div class="h-[60px] md:h-[72px] bg-white dark:bg-gray-800 mb-8"></div>

<section class="container mx-auto mb-8">
	<div class="mx-4 2xl:mx-0 md:px-24 mb-8">
		<div class="mb-6">
			<A href="/hikes/#projects" class="inline-flex items-center">
				<ArrowLeftOutline class="w-5 h-5 me-2" />
				{t('en', 'nav.backToAll')}
			</A>
		</div>

		{#if children}
			{@render children()}
		{:else if pagination.currentPage > 1}
			<Heading tag="h2" class="mb-8">{t('en', 'list.tagPage', { tag: label, page: pagination.currentPage })}</Heading>
		{:else}
			<Heading tag="h2" class="mb-8">
				{taggedBefore}<span class="text-primary-600 dark:text-primary-500">{label}</span>{taggedAfter}
			</Heading>
		{/if}

		<div class="mt-8">
			<HikeList {posts} {showPeople} />
			<CustomPagination
				currentPage={pagination.currentPage}
				totalPages={pagination.totalPages}
				baseUrl={`/hikes/tag/${encodeURIComponent(tag)}`}
			/>
		</div>
	</div>
</section>

<Feeds />


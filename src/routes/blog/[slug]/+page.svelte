<script lang="ts">
	import type { PageData } from './$types';
	import Markdown from '$lib/renderers/vendor/Markdown.svelte';
	import DefaultCode from '$lib/renderers/DefaultCode.svelte';
	import DefaultLink from '$lib/renderers/DefaultLink.svelte';
	import ToTopButton from '$lib/components/ToTopButton.svelte';
	import DefaultImage from '$lib/renderers/DefaultImage.svelte';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import AppJsonLd from '$lib/components/AppJsonLd.svelte';
	import { page } from '$app/state';
	import { A } from 'flowbite-svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<AppBreadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Blog', href: '/blog/' }, { name: data.post.title, href: `/blog/${data.post.anchor}/` }]} />
<AppJsonLd
	variant="blog-post"
	title={data.post.title}
	description={data.post.description}
	image={data.post.image}
	isoDate={data.post.isoDate}
	author={data.post.author}
	tags={data.post.tags}
	anchor={data.post.anchor}
/>
<AppMeta
	title={data.post.title}
	description={data.post.description ?? undefined}
	image={data.post.image}
	type="article"
	tags={data.post.tags}
	article-published_time="{data.post.date}T16:00:00+00:00"
	article-author={data.post.author}
	article-section="Programming"
/>

<article class="mx-4 2xl:mx-0">
	<div class="mx-auto prose dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-500 md:prose-lg lg:prose-xl min-h-80">
		<div class="flex flex-row flex-wrap gap-2">
			<span>{data.post.author}</span>
			·
			<span>{data.post.time}</span>
			·
			<span>{data.post.date}</span>
			{#if data.post.tags?.length}
				·
				<div class="flex flex-row justify-end gap-2" aria-details="tags">
					<span aria-label="tags" class="sr-only"></span>
					{#each data.post.tags as t}
						<A href={`/blog/tag/${encodeURIComponent(t)}/`}>{t}</A>
					{/each}
				</div>
			{/if}
		</div>
		{#if data.post.imageFull}
			<img src={data.post.imageFull} class="w-full xl:w-3/4 mx-auto !mb-8 !mt-0 object-contain rounded-sm border border-gray-200 dark:border-gray-800" alt="Main" />
		{/if}
		<Markdown source={data.post.content} renderers={{ code: DefaultCode, link: DefaultLink, image: DefaultImage }} />
	</div>
</article>

<ToTopButton />

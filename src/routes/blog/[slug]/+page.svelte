<script lang="ts">
	import type { PageData } from './$types';
	import Markdown from '$lib/renderers/vendor/Markdown.svelte';
	import DefaultCode from '$lib/renderers/DefaultCode.svelte';
	import DefaultLink from '$lib/renderers/DefaultLink.svelte';
	import ToTopButton from '$lib/components/ToTopButton.svelte';
	import BlogImage from '$lib/blog/BlogImage.svelte';
	import ResponsivePicture from '$lib/renderers/ResponsivePicture.svelte';
	import { responsivePicture } from '$lib/renderers/responsive-image';
	import { imageMetaFor } from '$lib/renderers/image-meta';
	import { BLOG_IMAGES, BLOG_IMAGE_SIZES } from '$lib/blog/blog-images';
	import { setContext } from 'svelte';
	import AuthorBox from '$lib/components/AuthorBox.svelte';
	import resume from '$lib/data/resume.json';
	import FigureParagraph from '$lib/renderers/FigureParagraph.svelte';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import AppJsonLd from '$lib/components/AppJsonLd.svelte';
	import { page } from '$app/state';
	import { A } from 'flowbite-svelte';
	import { blogDateTime } from '$lib/blog/blog-meta';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// A getter: the page component is reused when navigating from post to post.
	setContext(BLOG_IMAGES, () => data.post.images);
	const heroMeta = $derived(data.post.imageFull ? imageMetaFor(data.post.images, data.post.imageFull) : undefined);
	const showDate = (iso: string) =>
		new Date(iso).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	// Readers judge code by how recent it is: show the last body change when there was one after publishing.
	const updated = $derived(data.post.dateModified !== data.post.isoDate ? data.post.dateModified : null);
	const heroPicture = $derived(data.post.imageFull ? responsivePicture(data.post.imageFull, heroMeta) : null);
</script>

<AppBreadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Blog', href: '/blog/' }, { name: data.post.title, href: `/blog/${data.post.anchor}/` }]} />
<AppJsonLd
	variant="blog-post"
	title={data.post.title}
	description={data.post.description}
	image={data.post.image}
	imageFull={data.post.imageFull}
	bodyImages={data.post.bodyImages}
	isoDate={data.post.isoDate}
	dateModified={data.post.dateModified}
	section={data.post.section}
	wordCount={data.post.wordCount}
	minutes={data.post.minutes}
	tags={data.post.tags}
	anchor={data.post.anchor}
/>
<AppMeta
	title={data.post.title}
	description={data.post.description ?? undefined}
	image={data.post.image ?? undefined}
	type="article"
	tags={data.post.tags}
	article-published_time={blogDateTime(data.post.isoDate)}
	article-modified_time={blogDateTime(data.post.dateModified)}
	article-author={data.post.author ?? undefined}
	article-section={data.post.section ?? undefined}
/>

<article class="mx-4 2xl:mx-0">
	<div class="mx-auto prose dark:prose-invert prose-a:text-primary-600 dark:prose-a:text-primary-500 md:prose-lg lg:prose-xl min-h-80">
		<div class="flex flex-row flex-wrap gap-2">
			<span>{data.post.author}</span>
			·
			<span>{data.post.time}</span>
			·
			<time datetime={data.post.isoDate}>{data.post.date}</time>
			{#if updated}
				·
				<span>Updated <time datetime={updated}>{showDate(updated)}</time></span>
			{/if}
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
		{#if heroPicture}
			<ResponsivePicture
				picture={heroPicture}
				alt={data.post.imageAlt}
				sizes={BLOG_IMAGE_SIZES}
				eager
				class="w-full xl:w-3/4 mx-auto !mb-8 !mt-0 rounded-sm border border-gray-200 dark:border-gray-800"
			/>
		{:else if data.post.imageFull}
			<img
				src={data.post.imageFull}
				width={heroMeta?.w || undefined}
				height={heroMeta?.h || undefined}
				fetchpriority="high"
				class="w-full xl:w-3/4 mx-auto !mb-8 !mt-0 object-contain rounded-sm border border-gray-200 dark:border-gray-800"
				alt={data.post.imageAlt}
			/>
		{/if}
		<Markdown source={data.post.content} renderers={{ code: DefaultCode, link: DefaultLink, image: BlogImage, paragraph: FigureParagraph }} />
		<AuthorBox profiles={['GitHub', 'LinkedIn', 'Google Scholar']}>
			<p>{resume.basics.quote}</p>
		</AuthorBox>
	</div>
</article>

<ToTopButton />

<script lang="ts">
	import { Heading, Img, Span, Badge } from 'flowbite-svelte';
	import { ImageSolid } from 'flowbite-svelte-icons';
	import DateBadge from '$lib/components/DateBadge.svelte';
	import type { ProcessedBlogPost } from '$lib/blog/blog-info';

	interface Props {
		posts: ProcessedBlogPost[];
	}

	let { posts }: Props = $props();
</script>

<div class="flex flex-col gap-4">
	{#each posts as p}
		<div
			class="flex flex-col md:flex-row w-full md:min-h-48
			rounded-lg shadow-lg relative z-0
			bg-white dark:bg-gray-800
			text-gray-500 dark:text-gray-400
			group hover:shadow-xl transition-shadow duration-200"
		>
			<a href={p.url} class="absolute inset-0 z-10 block" aria-label={p.title}></a>

			<div class="relative block md:max-h-48 md:min-h-48 md:min-w-64 !aspect-crt overflow-hidden rounded-t-lg md:rounded-tr-none md:rounded-l-lg">
				<div class="w-full md:w-auto md:h-full aspect-crt flex justify-center items-center">
					<ImageSolid aria-hidden="true" class="w-16 h-16 text-gray-500 dark:text-gray-500" />
				</div>
				{#if p.image}
					<div class="absolute top-0 left-0 bottom-0 right-0">
						<Img src={p.image ?? undefined} class="w-full h-full aspect-crt rounded-l-lg object-cover object-center group-hover:scale-105 transition-transform duration-500" />
					</div>
				{/if}
			</div>
			<div class="flex-grow flex flex-col p-4">
				<Heading tag="h3" class="group-hover:text-primary-600 dark:group-hover:text-primary-500 transition-colors">{p.title}</Heading>
				<Span class="flex-grow pt-4">{p.description}</Span>
				<div class="pt-4 w-full flex flex-row">
					<div class="relative z-20">
						<DateBadge date={p.date} dateEnd={undefined} />
					</div>
					<div class="flex-grow flex flex-row justify-end gap-2 flex-wrap relative z-20" aria-details="tags">
						<span aria-label="tags" class="sr-only"></span>
						{#each p.tags as t}
							<a href={`/blog/tag/${encodeURIComponent(t)}/`} class="relative z-20">
								<Badge class="cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors">{t}</Badge>
							</a>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/each}
</div>

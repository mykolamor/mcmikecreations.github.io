<script lang="ts">
	/* eslint-disable svelte/no-at-html-tags */
	import { A, Badge, Card, Heading, Span } from 'flowbite-svelte';
	import DateBadge from '$lib/components/DateBadge.svelte';
	import type { ProcessedBlogPost } from '$lib/blog/blog-info';

	interface Props {
		posts: ProcessedBlogPost[];
	}

	let { posts }: Props = $props();

	const hasPosts = $derived(posts.length > 0);
</script>

{#if hasPosts}
	<section id="blog">
		<Heading tag="h2" class="text-center mt-8">Latest <A href="/blog/">Blog</A> Posts</Heading>
		<div class="flex flex-wrap justify-center gap-4 mt-8 mx-4 2xl:mx-0">
			{#each posts as p}
				<Card
					href={p.url}
					img={p.image ?? undefined}
					classes={{ image: "w-full aspect-crt object-cover object-center" }}
					class="max-w-sm lg:max-w-xl flex-1"
				>
					<div class="m-4 sm:m-6 text-gray-500 dark:text-gray-400">
						<Heading tag="h3">{p.title}</Heading>
						<Span class="pt-4 flex-grow">{@html p.description}</Span>
						<div class="pt-4 w-full flex flex-row">
							<DateBadge date={p.date} dateEnd={undefined} />
							<div class="flex-grow flex flex-row flex-wrap justify-end gap-2 ps-2" aria-details="tags">
								<span aria-label="tags" class="sr-only"></span>
								{#each p.tags as t}
									<Badge>{t}</Badge>
								{/each}
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	</section>
{/if}

<script lang="ts">
	import type { Snippet } from 'svelte';
	import resume from '$lib/data/resume.json';
	import { AUTHOR_PAGE } from '$lib/author';

	/**
	 * Who wrote the post, at its end: photo, name, current role and a few lines
	 * of context. Name, photo and role come from the résumé; the context is the caller's (`children`), so the blog
	 * speaks about programming and the hike posts can speak about alpine experience with the same box.
	 */
	interface Props {
		/** The heading above the name. */
		heading?: string;
		/** Résumé profile networks to link, in order (`GitHub`, `Strava`, …). */
		profiles?: string[];
		children?: Snippet;
	}

	let { heading = 'About the author', profiles = [], children }: Props = $props();

	const { name, image, label } = resume.basics;
	const currentJob = resume.work.find((w) => !w.endDate);
	const role = currentJob ? `${currentJob.position}, ${currentJob.name}` : label;
	const links = $derived(
		profiles
			.map((network) => resume.basics.profiles.find((p) => p.network === network))
			.filter((p): p is (typeof resume.basics.profiles)[number] => !!p)
	);
</script>

<aside
	aria-labelledby="author-box-heading"
	class="not-prose mt-12 flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-5 sm:flex-row sm:items-start dark:border-gray-700 dark:bg-gray-800"
>
	<img src={image} alt="" width="96" height="96" loading="lazy" decoding="async" class="h-20 w-20 shrink-0 rounded-full object-cover" />
	<div class="flex flex-col gap-1 text-gray-700 dark:text-gray-300">
		<h2 id="author-box-heading" class="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">{heading}</h2>
		<p class="text-lg font-semibold text-gray-900 dark:text-white">
			<a href={AUTHOR_PAGE} class="hover:underline" rel="author">{name}</a>
		</p>
		<p class="text-sm">{role}</p>
		{#if children}
			<div class="mt-2 text-base">{@render children()}</div>
		{/if}
		{#if links.length}
			<p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{#each links as p (p.network)}
					<a href={p.url} target="_blank" rel="noopener noreferrer me" class="text-primary-600 hover:underline dark:text-primary-500">{p.network}</a>
				{/each}
			</p>
		{/if}
	</div>
</aside>

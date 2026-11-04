<script lang="ts">
    import { Heading, Img, Span, Badge } from 'flowbite-svelte';
    import { UserSolid } from 'flowbite-svelte-icons';
    import DateBadge from '$lib/components/DateBadge.svelte';
    import type { ProcessedPost } from '$lib/hikes/hikes-info';
    import { tagLabel } from '$lib/hikes/hikes-meta';
    import { t } from '$lib/i18n/strings';

    export let posts: ProcessedPost[] = [];
    export let showPeople: boolean = false;
</script>

<div data-sveltekit-preload-data="off" class="flex flex-col gap-8">
    {#each posts as p}
        <div
            class="flex flex-col md:flex-row w-full md:min-h-48
    rounded-lg shadow-lg
    bg-white dark:bg-gray-800 relative z-0
    text-gray-500 dark:text-gray-400
    group hover:shadow-xl transition-shadow duration-200
    scroll-my-28"
            id={p.anchor}
        >
            <a href={p.url} class="absolute inset-0 z-10 block" aria-label={p.title}></a>

            <div class="block md:max-h-48 md:min-h-48 md:min-w-64 !aspect-crt overflow-hidden rounded-t-lg md:rounded-tr-none md:rounded-l-lg">
                {#if p.image}
                    <Img src={p.image ?? undefined} class="w-full h-full aspect-crt object-cover object-center group-hover:scale-105 transition-transform duration-500" />
                {/if}
            </div>
            <div class="flex-grow flex flex-col p-4">
                <Heading tag="h3" class="group-hover:text-primary-600 dark:group-hover:text-primary-500 transition-colors">{p.title}</Heading>
                <Span class="flex-grow pt-4">{@html p.description}</Span>
                <div class="pt-4 w-full flex flex-row items-center">
                    <div class="relative z-20 hover:text-primary-600 dark:hover:text-primary-500 transition-colors">
                        <a href={`/hikes/year/${p.year}/`}>
                            <DateBadge date={p.date} dateEnd={undefined} />
                        </a>
                    </div>
                    <div class="flex-grow flex flex-row justify-end gap-2 relative z-20" aria-details="tags">
                        <span aria-label={t('en', 'list.tagsLabel')} class="sr-only"></span>
                        {#if showPeople && p.people}
                            {#each p.people as person}
                                <Badge rounded>
                                    <UserSolid class="me-1.5 size-2.5" />
                                    {person}
                                </Badge>
                            {/each}
                        {/if}
                        {#each p.tags as tag}
                            <a href={`/hikes/tag/${encodeURIComponent(tag)}/`}>
                                <Badge class="cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors">{tagLabel('en', tag)}</Badge>
                            </a>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    {/each}
</div>

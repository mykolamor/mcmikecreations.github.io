<script lang="ts">
	import { UserSolid } from 'flowbite-svelte-icons';
	import { networkIcon } from '$lib/icons/network-icons';
	import type { HikeContact } from '$lib/hikes/frontmatter';
	import type { Lang } from '$lib/i18n/languages';
	import { t } from '$lib/i18n/strings';

	interface Props {
		contacts: HikeContact[];
		lang: Lang;
	}

	let { contacts, lang }: Props = $props();
</script>

{#if contacts.length}
	<section class="not-prose mt-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6">
		<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t(lang, 'post.contacts.heading')}</h2>
		<ul class="flex flex-col gap-4">
			{#each contacts as person}
				<li class="flex items-center gap-4">
					<div class="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400">
						{#if person.avatar}
							<img src={person.avatar} alt={person.name} class="w-full h-full object-cover" />
						{:else}
							<UserSolid class="w-6 h-6" aria-hidden="true" />
						{/if}
					</div>
					<div class="min-w-0 flex-grow">
						<div class="font-medium text-gray-900 dark:text-white truncate">{person.name}</div>
						{#if person.links.length}
							<div class="mt-1 flex flex-row flex-wrap items-center gap-3">
								{#each person.links as link}
									{@const label = link.network ?? link.label ?? t(lang, 'post.contacts.link')}
									{@const Icon = networkIcon(link.network)}
									<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={label}
										title={label}
										class="text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-500 transition-colors"
									>
										<Icon class="w-5 h-5" aria-hidden="true" />
									</a>
								{/each}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

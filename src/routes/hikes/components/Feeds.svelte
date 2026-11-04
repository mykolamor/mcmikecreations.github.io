<script>
	import { A } from 'flowbite-svelte';
	import FeedSolid from '$lib/icons/FeedSolid.svelte';
	import { FileCodeSolid } from 'flowbite-svelte-icons';
	import { t } from '$lib/i18n/strings';
</script>

<svelte:head>
	<link rel="alternate" type="application/rss+xml" title={t('en', 'feeds.rssTitle')} href="/hikes/feed.xml" />
	<link rel="alternate" type="application/atom+xml" title={t('en', 'feeds.atomTitle')} href="/hikes/atom.xml" />
</svelte:head>

<section class="container mx-auto mb-8">
	<div class="mx-4 2xl:mx-0 md:px-24 flex flex-row justify-between">
		<div>
			<A href="/hikes/feed.xml" target="_blank" rel="noopener noreferrer" data-sveltekit-reload><FeedSolid ariaLabel={t('en', 'feeds.rss')} class="me-1" /> {t('en', 'feeds.rss')}</A>
		</div>
		<div>
			<A href="/hikes/atom.xml" target="_blank" rel="noopener noreferrer" data-sveltekit-reload><FeedSolid ariaLabel={t('en', 'feeds.atom')} class="me-1" /> {t('en', 'feeds.atom')}</A>
		</div>
		<div>
			<A href="/hikes/index.json" target="_blank" rel="noopener noreferrer" data-sveltekit-reload><FileCodeSolid ariaLabel={t('en', 'feeds.json')} class="me-1" /> {t('en', 'feeds.json')}</A>
		</div>
	</div>
</section>
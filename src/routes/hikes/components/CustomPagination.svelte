<script lang="ts">
  import { ArrowLeftOutline, ArrowRightOutline } from 'flowbite-svelte-icons';
  import { page } from '$app/state';
  import { getPageUrl as pageUrl } from '$lib/pagination';
  import { t } from '$lib/i18n/strings';

  interface Props {
    currentPage: number;
    totalPages: number;
    baseUrl: string;
  }

  let { currentPage, totalPages, baseUrl }: Props = $props();

  const getPageUrl = (page: number) => pageUrl(baseUrl, page);

  const visiblePages = 5;
  const halfVisible = $derived(Math.floor(visiblePages / 2));
  const lastPage = $derived(Math.min(Math.max(currentPage + halfVisible, visiblePages), totalPages));
  const firstPage = $derived(Math.max(1, lastPage - visiblePages + 1));
  const pageNumbers = $derived(
    Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage + i)
  );

  const origin = $derived(page.url.origin);
  const prevUrl = $derived(currentPage > 1 ? origin + getPageUrl(currentPage - 1) : null);
  const nextUrl = $derived(currentPage < totalPages ? origin + getPageUrl(currentPage + 1) : null);

  const btnBase = 'flex items-center font-medium h-8 px-3 text-sm border';
  const btnActive = `${btnBase} text-primary-600 border-gray-300 bg-primary-50 hover:bg-primary-100 hover:text-primary-700 dark:border-gray-700 dark:bg-gray-700 dark:text-white`;
  const btnInactive = `${btnBase} text-gray-500 bg-white hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white`;
  const btnDisabled = `${btnInactive} cursor-not-allowed opacity-50`;
</script>

<svelte:head>
  {#if prevUrl}<link rel="prev" href={prevUrl}>{/if}
  {#if nextUrl}<link rel="next" href={nextUrl}>{/if}
</svelte:head>

<div class="flex justify-center mt-8">
  <nav aria-label={t('en', 'nav.pagination')} data-sveltekit-replacestate data-sveltekit-keepfocus>
    <ul class="inline-flex -space-x-px rtl:space-x-reverse items-center">
      <li>
        {#if prevUrl}
          <a href={prevUrl} class="{btnInactive} rounded-none rounded-s-lg">
            <span class="sr-only">{t('en', 'nav.previous')}</span>
            <ArrowLeftOutline class="h-5 w-5" />
          </a>
        {:else}
          <span class="{btnDisabled} rounded-none rounded-s-lg" aria-disabled="true">
            <span class="sr-only">{t('en', 'nav.previous')}</span>
            <ArrowLeftOutline class="h-5 w-5" />
          </span>
        {/if}
      </li>
      {#each pageNumbers as page (page)}
        <li>
          {#if page === currentPage}
            <span class="{btnActive} select-none" aria-current="page">{page}</span>
          {:else}
            <a href={getPageUrl(page)} class={btnInactive}>{page}</a>
          {/if}
        </li>
      {/each}
      <li>
        {#if nextUrl}
          <a href={nextUrl} class="{btnInactive} rounded-none rounded-e-lg">
            <span class="sr-only">{t('en', 'nav.next')}</span>
            <ArrowRightOutline class="h-5 w-5" />
          </a>
        {:else}
          <span class="{btnDisabled} rounded-none rounded-e-lg" aria-disabled="true">
            <span class="sr-only">{t('en', 'nav.next')}</span>
            <ArrowRightOutline class="h-5 w-5" />
          </span>
        {/if}
      </li>
    </ul>
  </nav>
</div>

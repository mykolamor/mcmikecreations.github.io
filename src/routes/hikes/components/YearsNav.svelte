<script lang="ts">
  import { Badge } from 'flowbite-svelte';
  import { t } from '$lib/i18n/strings';

  interface Props {
    years: number[];
  }
  let { years }: Props = $props();
</script>

<div class="flex flex-wrap gap-2 justify-start my-4">
  <span class="text-sm font-medium text-gray-500 dark:text-gray-400 self-center mr-2">{t('en', 'nav.years')}</span>
  {#each years as year}
    <a href={`/hikes/year/${year}/`} class="no-underline group">
      <Badge size="large" class="group-hover:bg-indigo-200 dark:group-hover:bg-indigo-800 transition-colors cursor-pointer">
        {year}
      </Badge>
    </a>
  {/each}
</div>



<script lang="ts">
	// One tile of the post's title card: an icon, a small caption and the value,
	// optionally a link and a tooltip. Shared by the computed and the facts tiles.
	import type { ClockOutline } from 'flowbite-svelte-icons';

	interface Props {
		icon: typeof ClockOutline;
		label: string;
		value: string;
		/** Tooltip on the whole tile. */
		hint?: string;
		/** Makes the value a link. */
		href?: string;
	}

	let { icon: Icon, label, value, hint, href }: Props = $props();
</script>

<div class="flex items-center gap-3 basis-[140px] grow" title={hint}>
	<div class="text-primary-600 dark:text-primary-500 bg-primary-100 dark:bg-primary-900 rounded-lg p-2 shrink-0">
		<Icon class="w-6 h-6" />
	</div>
	<div>
		<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
		{#if href}
			<a class="block font-semibold whitespace-nowrap underline decoration-dotted underline-offset-4 hover:decoration-solid" {href} translate="no">{value}</a>
		{:else}
			<div class="font-semibold whitespace-nowrap" translate="no">{value}</div>
		{/if}
	</div>
</div>

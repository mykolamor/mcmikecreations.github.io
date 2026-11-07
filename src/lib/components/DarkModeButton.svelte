<script lang="ts">
	import { twMerge } from 'tailwind-merge';
	import { toggleTheme } from '$lib/components/DarkModeStore';
	import SunSolid from '$lib/icons/SunSolid.svelte';
	import MoonSolid from '$lib/icons/MoonSolid.svelte';
    import type { Snippet } from "svelte";

	const btnClassConst : string = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-hidden focus:ring-1 focus:ring-gray-200 dark:focus:ring-gray-700 rounded-lg text-sm p-2';
	const sizes : Map<string, string> = new Map<string, string>([
		['sm', 'w-4 h-4'],
		['md', 'w-5 h-5'],
		['lg', 'w-6 h-6']
	]);
	let {
        btnClass = btnClassConst,
        size = 'md',
        ariaLabel = 'Dark mode',
        lightIcon = undefined,
        darkIcon = undefined,
        class: propsClass,
        ...other
    } = $props();
</script>

<button onclick={toggleTheme} aria-label={ariaLabel} type="button" {...other} class={twMerge(btnClass, propsClass)}>
    <span class="hidden dark:block">
        {#if lightIcon}
            {@render lightIcon()}
        {:else}
            <SunSolid class={sizes.get(size)} />
        {/if}
    </span>
    <span class="block dark:hidden">
        {#if darkIcon}
            {@render darkIcon()}
        {:else}
            <MoonSolid class={sizes.get(size)} />
        {/if}
    </span>
</button>

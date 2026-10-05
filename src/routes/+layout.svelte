<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import type { Snippet } from "svelte";
	import DarkModeHandler from '$lib/components/DarkModeHandler.svelte';
    import AppNavbar from "$lib/components/AppNavbar.svelte";
	import AppFooter from '$lib/components/AppFooter.svelte';
	import { ThemeProvider } from 'flowbite-svelte';
	import type { ThemeConfig } from 'flowbite-svelte';

	// Flowbite's <A> only underlines on hover, so highlighted links read as plain
	// coloured text. Underline every <A> app-wide so it's obviously clickable.
	const theme: ThemeConfig = {
		anchor: 'underline underline-offset-2 hover:decoration-2 cursor-pointer'
	};

	interface Props {
		shouldShowNavbar?: 'true' | 'false' | undefined;
		shouldFixNavbar?: 'true' | 'false' | undefined;
		children?: Snippet;
	}

	let { shouldShowNavbar = undefined, shouldFixNavbar = undefined, children }: Props = $props();
	let showNavbar = $derived(shouldShowNavbar !== undefined ? (shouldShowNavbar === 'true') : (page.data.header?.showNavbar ?? true));
	let fixedNavbar = $derived(shouldFixNavbar !== undefined ? (shouldFixNavbar === 'true') : (page.data.header?.fixedNavbar ?? false));

	let activeUrl = $derived(page.url.pathname);
</script>

<DarkModeHandler />

<ThemeProvider {theme}>
<div class="flex flex-col min-h-[100dvh]">
	{#if showNavbar}
		<AppNavbar {fixedNavbar} />
	{/if}

	<div class="flex-grow flex flex-col w-full">
		{@render children?.()}
	</div>

	<AppFooter />
</div>
</ThemeProvider>

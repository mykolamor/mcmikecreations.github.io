<script lang="ts">
	// flowbite-svelte 1.33.1's NavHamburger (see ./context.ts): toggles the Navbar's menu.
	import { cx } from './cx';
	import type { ClassValue } from 'svelte/elements';
	import { ToolbarButton, getTheme, navbarHamburger } from 'flowbite-svelte';
	import Menu from 'flowbite-svelte/Menu.svelte';
	import { getNavbarState } from './context';

	interface Props {
		class?: ClassValue;
		classes?: { menu?: ClassValue };
		name?: string;
	}

	let { class: className, classes, name = 'Open main menu' }: Props = $props();

	const navState = getNavbarState();
	const theme = $derived(getTheme('navbarHamburger'));
	const slots = $derived(navbarHamburger({ breakpoint: navState.breakpoint }));

	const toggle = () => {
		navState.hidden = !navState.hidden;
	};
</script>

<ToolbarButton {name} onclick={toggle} class={slots.base({ class: cx(theme?.base, className) })}>
	<Menu class={slots.menu({ class: cx(theme?.menu, classes?.menu) })} />
</ToolbarButton>

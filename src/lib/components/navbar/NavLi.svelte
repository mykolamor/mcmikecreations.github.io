<script lang="ts">
	// flowbite-svelte 1.33.1's NavLi (see ./context.ts), links only: active when
	// `href` equals the NavUl's `activeUrl`.
	import { cx } from './cx';
	import type { Snippet } from 'svelte';
	import type { ClassValue, HTMLAnchorAttributes } from 'svelte/elements';
	import { getTheme, navbarLi } from 'flowbite-svelte';
	import { getNavbarState, getNavUlState } from './context';

	interface Props extends Omit<HTMLAnchorAttributes, 'class'> {
		children?: Snippet;
		href: string;
		class?: ClassValue;
		activeClass?: ClassValue;
		nonActiveClass?: ClassValue;
	}

	let { children, onclick, activeClass, nonActiveClass, class: className, ...restProps }: Props = $props();

	const navState = getNavbarState();
	const ulState = getNavUlState();
	const theme = $derived(getTheme('navbarLi'));

	const active = $derived(ulState.activeUrl !== undefined && restProps.href === ulState.activeUrl);
	const liClass = $derived(
		navbarLi({
			breakpoint: navState.breakpoint,
			hidden: navState.hidden,
			class: cx(active ? (activeClass ?? ulState.activeClass) : (nonActiveClass ?? ulState.nonActiveClass), theme, className)
		})
	);

	function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLAnchorElement }) {
		// Close the mobile menu when a link is clicked.
		if (!navState.hidden) navState.hidden = true;
		onclick?.(event);
	}
</script>

<li>
	<a {...restProps} class={liClass} onclick={handleClick}>
		{@render children?.()}
	</a>
</li>

<script lang="ts">
	// flowbite-svelte 1.33.1's Navbar (see ./context.ts), with `aria-label` on the
	// <nav> itself: flowbite hands every attribute to the inner div.
	import { cx } from './cx';
	import { untrack, type Snippet } from 'svelte';
	import type { ClassValue, HTMLAttributes } from 'svelte/elements';
	import { NavContainer, getTheme, navbar } from 'flowbite-svelte';
	import { setNavbarState, type NavbarBreakpoint, type NavbarState } from './context';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children: Snippet<[{ hidden: boolean; toggle: () => void }]>;
		fluid?: boolean;
		navContainerClass?: ClassValue;
		closeOnClickOutside?: boolean;
		breakpoint?: NavbarBreakpoint;
	}

	let { children, fluid, navContainerClass, class: className, closeOnClickOutside = true, breakpoint = 'md', 'aria-label': ariaLabel, ...restProps }: Props = $props();

	const theme = $derived(getTheme('navbar'));

	let hidden = $state(true);
	let currentBreakpoint = $state(untrack(() => breakpoint));
	$effect(() => {
		currentBreakpoint = breakpoint;
	});

	const navState: NavbarState = {
		get hidden() {
			return hidden;
		},
		set hidden(value) {
			hidden = value;
		},
		get breakpoint() {
			return currentBreakpoint;
		}
	};
	setNavbarState(navState);

	const toggle = () => {
		hidden = !hidden;
	};

	let navbarElement: HTMLElement;

	function handleDocumentClick(event: MouseEvent) {
		if (!closeOnClickOutside) return;
		if (!hidden && navbarElement && !navbarElement.contains(event.target as Node)) hidden = true;
	}
</script>

<svelte:document onclick={handleDocumentClick} />

<nav bind:this={navbarElement} aria-label={ariaLabel}>
	<div {...restProps} class={navbar({ class: cx(theme, className) })}>
		<NavContainer {fluid} class={cx(navContainerClass)}>
			{@render children({ hidden, toggle })}
		</NavContainer>
	</div>
</nav>

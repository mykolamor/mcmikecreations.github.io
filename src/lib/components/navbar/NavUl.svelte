<script lang="ts">
	// flowbite-svelte 1.33.1's NavUl (see ./context.ts), without its deprecated
	// props. The active URL and classes reach the NavLis through getters, not an
	// $effect, so the active item is styled in the prerendered HTML too.
	import { cx } from './cx';
	import type { Snippet } from 'svelte';
	import type { ClassValue, HTMLAttributes } from 'svelte/elements';
	import { sineIn } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide, type SlideParams } from 'svelte/transition';
	import { getTheme, navbarUl } from 'flowbite-svelte';
	import { getNavbarState, setNavUlState } from './context';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> {
		children?: Snippet;
		activeUrl?: string;
		transitionParams?: SlideParams;
		respectMotionPreference?: boolean;
		class?: ClassValue;
		classes?: { ul?: ClassValue; active?: ClassValue; nonActive?: ClassValue };
	}

	let { children, activeUrl, transitionParams, respectMotionPreference = true, class: className, classes, ...restProps }: Props = $props();

	const navState = getNavbarState();
	const theme = $derived(getTheme('navbarUl'));
	const hidden = $derived(navState.hidden);
	const slots = $derived(navbarUl({ hidden, breakpoint: navState.breakpoint }));

	const activeClass = $derived(slots.active({ class: cx(theme?.active, classes?.active) }));
	const nonActiveClass = $derived(slots.nonActive({ class: cx(theme?.nonActive, classes?.nonActive) }));
	setNavUlState({
		get activeUrl() {
			return activeUrl;
		},
		get activeClass() {
			return activeClass;
		},
		get nonActiveClass() {
			return nonActiveClass;
		}
	});

	const params = $derived.by(() => {
		const p = transitionParams ?? { delay: 0, duration: 200, easing: sineIn };
		return respectMotionPreference && prefersReducedMotion.current ? { ...p, duration: 0, delay: 0 } : p;
	});

	const divCls = $derived(slots.base({ class: cx(theme?.base, className) }));
	const ulCls = $derived(slots.ul({ class: cx(theme?.ul, classes?.ul) }));
</script>

{#if !hidden}
	<div {...restProps} class={divCls} transition:slide={params}>
		<ul class={ulCls}>
			{@render children?.()}
		</ul>
	</div>
{:else}
	<div {...restProps} class={divCls}>
		<ul class={ulCls}>
			{@render children?.()}
		</ul>
	</div>
{/if}

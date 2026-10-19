<script lang="ts">
    import {Navbar, NavBrand, NavHamburger, NavLi, NavUl} from "flowbite-svelte";
    import DarkModeButton from "$lib/components/DarkModeButton.svelte";
    import HikesSearchBar from "$lib/hikes/HikesSearchBar.svelte";
    import { navItems } from "$lib/data/nav";
    import { page } from '$app/state';
    import { afterNavigate } from '$app/navigation';
    import { twMerge } from "tailwind-merge";
    import type {Snippet} from "svelte";

    interface Props {
        shouldFixNavbar?: 'true' | 'false' | undefined;
        title?: Snippet | undefined;
        fillNarrow?: boolean;
        alwaysBurger?: boolean;
        class?: string | undefined;
        bgClass?: string | undefined;
        bgClassUl?: string | undefined;
    }
    const bgClassDefault = 'bg-white dark:bg-gray-800';

    let { shouldFixNavbar = undefined, title, fillNarrow, alwaysBurger = false, class: propsClass, bgClass = bgClassDefault, bgClassUl = bgClass }: Props = $props();
    let fixedNavbar = $derived(shouldFixNavbar !== undefined ? (shouldFixNavbar === 'true') : (page.data.header?.fixedNavbar ?? false));
    let isHikesPage = $derived(
        page.url.pathname.startsWith('/hikes/')
    );
    let fixedProps = 'w-full px-2 py-2.5 sm:px-4 fixed z-50 top-0';
    let activeUrl = $derived.by(() => {
        const topLevelSegment = page.url.pathname.split('/')[1];
        return topLevelSegment ? `/${topLevelSegment}/` : '/';
    });

    // flowbite-svelte's NavUl sets these on navState only via $effect, which doesn't run
    // during SSR. Passing them as props to NavLi makes them available immediately,
    // preventing the black flash on initial page load (NavLi prefers the prop over context).
    const activeNavClass = "text-white bg-primary-700 dark:bg-primary-600 md:bg-transparent md:text-primary-700 md:dark:text-white md:dark:bg-transparent";
    const nonActiveNavClass = "hover:text-primary-500 text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white md:hover:bg-transparent md:border-0 md:hover:text-primary-700 dark:md:text-gray-400 md:dark:hover:text-white md:dark:hover:bg-transparent";

    // flowbite's Navbar renders the <nav> itself and hands attributes to an inner div,
    // so name the landmark from inside: it sits beside other navs (the home hero's).
    const labelNav = (node: HTMLElement) => {
        node.closest('nav')?.setAttribute('aria-label', 'Main');
    };

    // Track state to close navbar after navigation
    let closeDropdownAction: (() => void) | undefined = $state();

    afterNavigate(() => {
        if (closeDropdownAction) {
            closeDropdownAction();
        }
    });

    const bindCloseAction = (node: HTMLElement, params: { hidden: boolean, toggle: () => void }) => {
        closeDropdownAction = () => {
            if (!params.hidden && params.toggle) {
                params.toggle();
            }
        };
        return {
            update(newParams: { hidden: boolean, toggle: () => void }) {
                closeDropdownAction = () => {
                    if (!newParams.hidden && newParams.toggle) {
                        newParams.toggle();
                    }
                };
            },
            destroy() {
                if (closeDropdownAction === params.toggle) { // just to clear it roughly
                    closeDropdownAction = undefined;
                }
            }
        };
    };
</script>

<Navbar class={twMerge(`${fillNarrow ? '' : bgClass} ${fixedNavbar ? fixedProps : 'relative'}`, propsClass)} navContainerClass={alwaysBurger ? 'relative' : undefined}>
    {#snippet children({ hidden, toggle })}
        <NavBrand href="/">
            {#if title}
                {@render title()}
            {:else}
                <span class="self-center whitespace-nowrap text-xl font-semibold dark:text-white">Mykola Morozov</span>
            {/if}
        </NavBrand>
        <div class="flex md:order-2 items-center">
            {#if isHikesPage}
                <HikesSearchBar class="me-3" />
            {/if}
            <DarkModeButton class={fillNarrow ? bgClass : ''} />
            <NavHamburger class={twMerge(fillNarrow ? bgClass : '', alwaysBurger ? 'nav-hamburger-always-burger' : '')} />
        </div>

        <!-- invisible tracker specifically for connecting the auto-close state -->
        <span class="hidden" use:bindCloseAction={{ hidden, toggle }} use:labelNav></span>

        <NavUl
            {activeUrl}
            onclick={() => { if (!hidden) toggle(); }}
            class={alwaysBurger ? 'nav-ul-always-burger' : undefined}
            classes={{ ul: `md:space-x-8 md:mt-0 md:text-sm ${fillNarrow ? bgClassUl : ''} ${alwaysBurger ? 'md:!flex-col md:!rounded-lg' : ''}` }}
        >
            {#each navItems as item (item.href)}
                <NavLi class="md:p-0 rounded-sm" href={item.href} activeClass={item.href.includes('#') ? undefined : activeNavClass} nonActiveClass={nonActiveNavClass}>{item.label}</NavLi>
            {/each}
        </NavUl>
    {/snippet}
</Navbar>

<style>
    /* alwaysBurger: keep hamburger button visible even at md+ breakpoint */
    :global(.nav-hamburger-always-burger.md\:hidden) {
        display: inline-flex !important;
    }
    /* alwaysBurger: prevent nav links from auto-showing on desktop when closed */
    :global(.nav-ul-always-burger.hidden.md\:block) {
        display: none !important;
    }
    /* alwaysBurger: keep dropdown absolutely positioned below navbar, not inline */
    :global(.nav-ul-always-burger) {
        position: absolute !important;
        z-index: 50 !important;
    }
    /* alwaysBurger: on desktop shrink to content width and pin to the right (near burger) */
    @media (min-width: 48rem) {
        :global(.nav-ul-always-burger) {
            left: auto !important;
            width: auto !important;
        }
    }
</style>
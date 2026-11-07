/**
 * Shared state of the site's navbar components, copied from flowbite-svelte
 * 1.33.1's Navbar family (`navbar/*.svelte`), whose context is private to the
 * package. Owning the copy lets `Navbar` label its `<nav>` and makes the active
 * item correct in the prerendered HTML: flowbite sets the active URL from an
 * `$effect`, which doesn't run during SSR.
 */
import { createContext } from 'svelte';

export type NavbarBreakpoint = 'sm' | 'md' | 'lg' | 'xl';

/** Set by `Navbar`: whether the collapsed menu is closed, and at which breakpoint it expands. */
export interface NavbarState {
	hidden: boolean;
	readonly breakpoint: NavbarBreakpoint;
}

/** Set by `NavUl` for its `NavLi`s; getters, so SSR reads the current props. */
export interface NavUlState {
	readonly activeUrl: string | undefined;
	readonly activeClass: string;
	readonly nonActiveClass: string;
}

export const [getNavbarState, setNavbarState] = createContext<NavbarState>();
export const [getNavUlState, setNavUlState] = createContext<NavUlState>();

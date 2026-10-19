/**
 * The site's top-level navigation, in display order. AppNavbar renders all of
 * it; the home page's hero map renders everything but Home, one map peak each.
 */
import type { Component } from 'svelte';
import { BriefcaseOutline, EnvelopeOutline, FileLinesOutline, HomeOutline, NewspaperOutline } from 'flowbite-svelte-icons';
import MountainOutline from '$lib/icons/MountainOutline.svelte';

export interface NavItem {
	label: string;
	href: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	icon: Component<any>;
}

export const navItems: NavItem[] = [
	{ label: 'Home', href: '/', icon: HomeOutline },
	{ label: 'Résumé', href: '/resume/', icon: FileLinesOutline },
	{ label: 'Hikes', href: '/hikes/', icon: MountainOutline },
	{ label: 'Projects', href: '/projects/', icon: BriefcaseOutline },
	{ label: 'Blog', href: '/blog/', icon: NewspaperOutline },
	{ label: 'Contact', href: '/#contact', icon: EnvelopeOutline }
];

/** The hero map's labels: one peak per item, so this length is the peak count a hike needs. */
export const heroNavItems: NavItem[] = navItems.filter((item) => item.href !== '/');

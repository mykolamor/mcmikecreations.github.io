/**
 * Shared lookup from a social/contact network name to its icon component.
 *
 * Single source of truth for the network -> icon mapping used by the footer,
 * the CV/home social badges, and the hike participant contact cards. Keys are
 * normalized (lowercased, trimmed) so callers can pass names as written in
 * `resume.json` or post front matter without worrying about casing.
 *
 * Unknown names resolve to a generic link icon via `networkIcon`.
 */

import { FacebookSolid, GithubSolid, LinkedinSolid, XSolid, EnvelopeSolid, LinkOutline } from 'flowbite-svelte-icons';
import {
	BeRealSolid,
	BlueSkySolid,
	GoogleScholarSolid,
	InstagramSolid,
	KomootSolid,
	MastodonSolid,
	OrcidSolid,
	ResearchGateSolid,
	StravaSolid,
	TelegramSolid,
	TumblrSolid
} from '$lib/icons';

// Svelte component constructors are hard to type precisely across versions;
// this alias keeps the map readable without leaking `any` to callers.
type IconComponent = typeof LinkOutline;

/** Generic fallback icon for networks that have no dedicated mapping. */
export const FALLBACK_NETWORK_ICON: IconComponent = LinkOutline;

function normalize(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Map of normalized network name -> icon component. Covers every network used
 * in `resume.json`, including the email-style networks (TUM, Group107) which
 * render as an envelope.
 */
const NETWORK_ICONS: Record<string, IconComponent> = {
	github: GithubSolid,
	linkedin: LinkedinSolid,
	telegram: TelegramSolid,
	'google scholar': GoogleScholarSolid,
	researchgate: ResearchGateSolid,
	orcid: OrcidSolid,
	mastodon: MastodonSolid,
	facebook: FacebookSolid,
	instagram: InstagramSolid,
	x: XSolid,
	bluesky: BlueSkySolid,
	tumblr: TumblrSolid,
	bereal: BeRealSolid,
	strava: StravaSolid,
	komoot: KomootSolid,
	tum: EnvelopeSolid,
	group107: EnvelopeSolid
};

/**
 * Resolve a network name to its icon component, falling back to a generic link
 * icon when the name is empty or unrecognized.
 */
export function networkIcon(name: string | null | undefined): IconComponent {
	if (!name) return FALLBACK_NETWORK_ICON;
	return NETWORK_ICONS[normalize(name)] ?? FALLBACK_NETWORK_ICON;
}

/** True when a dedicated (non-fallback) icon exists for the given network. */
export function hasNetworkIcon(name: string | null | undefined): boolean {
	return !!name && normalize(name) in NETWORK_ICONS;
}

export type { IconComponent };

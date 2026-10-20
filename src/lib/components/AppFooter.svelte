<script lang="ts">
import resume from '$lib/data/resume.json';
import { page } from '$app/state';
import { Footer, FooterCopyright, FooterIcon, Tooltip } from 'flowbite-svelte';
import { networkIcon } from '$lib/icons/network-icons';
import { type ClassNameValue, twMerge } from 'tailwind-merge';

	interface Props {
		shouldPinBottom?: 'true' | 'false' | undefined;
		shouldShowSocials?: 'true' | 'false' | undefined;
		class?: ClassNameValue;
	}

	let { shouldPinBottom = undefined, shouldShowSocials = undefined, class: classProp }: Props = $props();

let pinBottom = $derived(shouldPinBottom !== undefined ? (shouldPinBottom === 'true') : (page.data.footer?.pinBottom ?? false));
let showSocials = $derived(shouldShowSocials !== undefined ? (shouldShowSocials === 'true') : (page.data.footer?.showSocials ?? true));

// Networks rendered in the footer, in display order. `ariaLabel` is the icon's
// label; `footerAriaLabel` sets aria-label on the FooterIcon anchor (only the
// email entry sets it); `tooltip` renders a Tooltip after the icon.
const socials: Array<{ network: string; ariaLabel: string; footerAriaLabel?: string; tooltip?: string }> = [
	{ network: 'TUM', ariaLabel: 'email', footerAriaLabel: 'email solid' },
	{ network: 'GitHub', ariaLabel: 'github' },
	{ network: 'LinkedIn', ariaLabel: 'linkedin' },
	{ network: 'Telegram', ariaLabel: 'telegram' },
	{ network: 'Google Scholar', ariaLabel: 'google scholar' },
	{ network: 'ResearchGate', ariaLabel: 'research gate' },
	{ network: 'Orcid', ariaLabel: 'orcid' },
	{ network: 'Mastodon', ariaLabel: 'mastodon' },
	{ network: 'Facebook', ariaLabel: 'facebook', tooltip: 'Facebook' },
	{ network: 'Instagram', ariaLabel: 'instagram' },
	{ network: 'X', ariaLabel: 'x' },
	{ network: 'BlueSky', ariaLabel: 'bluesky' },
	{ network: 'Tumblr', ariaLabel: 'tumblr' },
	{ network: 'BeReal', ariaLabel: 'bereal' },
	{ network: 'Strava', ariaLabel: 'strava' },
	{ network: 'Komoot', ariaLabel: 'komoot' }
];
</script>

<Footer
	footerType={pinBottom ? "default" : "socialmedia"}
	class={twMerge(pinBottom ? "absolute bottom-0 start-0 z-20 w-full" : 'mt-auto', classProp ?? '')}
>
	<div class="mx-auto flex flex-wrap {showSocials ? 'justify-between' : 'justify-center'} items-center container overflow-hidden">
		<FooterCopyright href="/" by={resume.basics.name} year={new Date().getFullYear()} />
		{#if showSocials}
			<div class="flex flex-wrap -ms-6 md:justify-center mt-0 [&_svg]:w-4 [&_svg]:h-4 [&_svg]:text-gray-500 [&_svg]:dark:text-gray-500 [&_svg:hover]:text-gray-900 [&_svg:hover]:dark:text-white">
				{#each socials as s}
					{@const Icon = networkIcon(s.network)}
					<FooterIcon href={resume.basics.profiles.find(x => x.network === s.network)?.url} target="_blank" rel="noopener noreferrer" class="ms-6 mt-4 md:mt-0" aria-label={s.footerAriaLabel}>
						<Icon ariaLabel={s.ariaLabel} />
					</FooterIcon>
					{#if s.tooltip}<Tooltip>{s.tooltip}</Tooltip>{/if}
				{/each}
			</div>
		{/if}
	</div>
</Footer>

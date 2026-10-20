<script lang="ts">
	import SocialBadge from '$lib/components/SocialBadge.svelte';
	import { networkIcon } from '$lib/icons/network-icons';

	interface Props {
		size?: string;
		padding?: string;
		pill?: boolean;
		outline?: boolean;
		plain?: boolean;
	}

	let {
		size = '[&>*]:!size-4 xl:[&>*]:!size-8',
		padding = '!p-2 xl:!p-4',
		pill = true,
		outline = true,
		plain = false
	}: Props = $props();

	// Networks shown as social badges, in display order.
	const networks = [
		'GitHub',
		'LinkedIn',
		'Telegram',
		'Google Scholar',
		'ResearchGate',
		'Orcid',
		'Mastodon',
		'Facebook',
		'Instagram',
		'X',
		'BlueSky',
		'Tumblr',
		'BeReal',
		'Strava',
		'Komoot'
	];
</script>

<!-- <SocialBadge profile="TUM"><EnvelopeSolid class="w-8 h-8" /></SocialBadge> -->
{#each networks as network}
	{@const Icon = networkIcon(network)}
	<SocialBadge profile={network} {size} {padding} {pill} {outline} {plain}><Icon aria-hidden="true" /></SocialBadge>
{/each}

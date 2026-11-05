<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { parseMediaFlags } from '$lib/renderers/media-flags';
	import ScriptEmbed from '$lib/renderers/ScriptEmbed.svelte';

	interface Props {
		href?: string;
		title?: any;
		text?: string;
	}

	let { href = '', title = undefined, text = '' }: Props = $props();
	let openModal = $state(false);
	const isYoutubeLink = $derived(href.includes('youtube.com'));
	const media = $derived(parseMediaFlags(title));
	const shouldAutoplay = $derived(media.flags.has('autoplay'));
	const invertClass = $derived(media.flags.has('invert') ? ' dark:invert' : '');
	/** `![caption](/demo.js)`: a script that draws its own demo, see `ScriptEmbed`. */
	const isScript = $derived(/\.m?js$/i.test(href.split(/[?#]/)[0]));

	// Track open modal to prevent scrolling the content behind it.
	$effect(() => {
		if (openModal) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (openModal && (e.key === 'Escape' || e.key === 'Esc')) {
			openModal = false;
			e.stopPropagation();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isScript}
	<ScriptEmbed {href} caption={text} />
{:else if isYoutubeLink}
	{@const url = new URL(href)}
	{@const videoId = url.searchParams.get('v')}
	<figure class="w-full xl:w-3/4 mx-auto flex flex-col justify-center">
		<a {href} target="_blank" rel="noopener noreferrer" class="group relative flex justify-center">
			<img
				src={`https://img.youtube.com/vi/${videoId}/0.jpg`}
				{title}
				alt={text}
				class="pointer-events-none !my-0"
			/>
			<span
				aria-hidden="true"
				class="pointer-events-none absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gray-900/50 text-white/85 transition group-hover:scale-105 group-hover:bg-gray-900/75"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-7 w-7">
					<path d="M5.5 4.5v15L18.5 12 5.5 4.5Z" />
				</svg>
			</span>
		</a>
		<figcaption class="text-center">{text}</figcaption>
	</figure>
{:else if href.trimEnd().endsWith('.mp4')}
	<figure class="w-full xl:w-3/4 mx-auto flex-col justify-center">
		<!-- Only clips flagged `autoplay` start on their own, and only those are
		     muted, since muting is what makes browsers allow autoplay at all.
		     An unflagged clip may carry audio, so it is left alone. -->
		<video
			controls
			autoplay={shouldAutoplay}
			muted={shouldAutoplay}
			loop
			playsinline
			title={media.title || undefined}
		>
			<source src={href} type="video/mp4">
		</video>
		<figcaption class="text-center">{text}</figcaption>
	</figure>
{:else}
	<figure class="w-full xl:w-3/4 mx-auto flex flex-col justify-center">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<img
			src={href}
			title={media.title || undefined}
			alt={text}
			class="cursor-pointer !my-0{invertClass}"
			onclick={() => (openModal = true)}
		/>
		<figcaption class="text-center">{text}</figcaption>
	</figure>
	<Modal bind:open={openModal} fullscreen size="none" classes={{ close: 'bg-white dark:bg-gray-900' }}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="flex h-full w-full items-center justify-center outline-hidden overscroll-contain"
			role="dialog"
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget) openModal = false;
			}}
		>
			<img
				src={href}
				title={media.title || undefined}
				alt={text}
				class="max-h-full max-w-full object-contain cursor-default{invertClass}"
				onclick={(e) => e.stopPropagation()}
			/>
		</div>
	</Modal>
{/if}

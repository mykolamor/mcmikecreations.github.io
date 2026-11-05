<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { parseMediaFlags } from '$lib/renderers/media-flags';
	import ScriptEmbed from '$lib/renderers/ScriptEmbed.svelte';
	import ResponsivePicture from '$lib/renderers/ResponsivePicture.svelte';
	import { responsivePicture, type HikeImageMeta } from '$lib/renderers/responsive-image';

	interface Props {
		href?: string;
		title?: any;
		/** The markdown alt text: the figure's caption. */
		text?: string;
		/** The `<img>` alt when it should differ from the caption (`BlogImage`); defaults to `text`. */
		alt?: string;
		/** The image's `images` front-matter entry, when the caller has one: size, and AVIF tiers when it has a blur. */
		meta?: HikeImageMeta;
		/** `sizes` for the AVIF `srcset`. */
		sizes?: string;
	}

	let { href = '', title = undefined, text = '', alt = undefined, meta = undefined, sizes = '100vw' }: Props = $props();
	const imgAlt = $derived(alt ?? text);
	const picture = $derived(responsivePicture(href, meta));
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
		{#if picture}
			<ResponsivePicture
				{picture}
				alt={imgAlt}
				title={media.title || undefined}
				{sizes}
				class="w-full"
				imgClass="cursor-pointer{invertClass}"
				onclick={() => (openModal = true)}
			/>
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<img
				src={href}
				title={media.title || undefined}
				alt={imgAlt}
				width={meta?.w || undefined}
				height={meta?.h || undefined}
				loading={meta ? 'lazy' : undefined}
				decoding={meta ? 'async' : undefined}
				class="cursor-pointer !my-0{invertClass}"
				onclick={() => (openModal = true)}
			/>
		{/if}
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
			<!-- The largest AVIF tier when there are tiers, not the full-size original. -->
			<picture class="contents">
				{#if picture}
					<source type="image/avif" srcset={picture.largest} />
				{/if}
				<img
					src={href}
					title={media.title || undefined}
					alt={imgAlt}
					class="max-h-full max-w-full object-contain cursor-default{invertClass}"
					onclick={(e) => e.stopPropagation()}
				/>
			</picture>
		</div>
	</Modal>
{/if}

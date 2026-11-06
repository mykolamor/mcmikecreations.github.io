<script lang="ts">
	import type { Component } from 'svelte';
	import { normalize } from './order';
	import type { PresentationDef } from './types';

	interface Props {
		/** URL of the presentation module, e.g. `/images/blog/post/presentation/index.js`. */
		href: string;
		caption?: string;
	}

	type FrameProps = { definition: PresentationDef; caption?: string; fallbackName?: string };

	let { href, caption = '' }: Props = $props();
	let definition: PresentationDef | undefined = $state();
	/** The frame component, loaded on demand so posts without a presentation don't bundle it. */
	let Frame: Component<FrameProps> | undefined = $state();

	/** The folder holding the module names the presentation when it has no `name`. */
	const fallbackName = $derived(href.split(/[?#]/)[0].split('/').filter(Boolean).slice(-2, -1)[0]);

	// Browser only, like ScriptEmbed: import once the page is hydrated.
	$effect(() => {
		const src = href;
		let cancelled = false;
		definition = undefined;

		Promise.all([import(/* @vite-ignore */ src), import('./Presentation.svelte')])
			.then(([mod, frame]: [{ default?: PresentationDef }, { default: Component<FrameProps> }]) => {
				if (cancelled) return;
				const def = mod.default;
				if (!def || !Array.isArray(def.slides)) {
					console.error(`Presentation ${src} has no default export with a slides array.`);
					return;
				}
				try {
					// normalize() throws on a malformed definition; catch it here
					// so a bad file leaves the placeholder instead of breaking the page.
					normalize(def);
				} catch (ex) {
					console.error(`Presentation ${src} is malformed:`, ex);
					return;
				}
				Frame = frame.default;
				definition = def;
			})
			.catch((ex) => console.error(`Failed to load presentation ${src}:`, ex));

		return () => {
			cancelled = true;
		};
	});
</script>

<figure class="w-full">
	{#if definition && Frame}
		<Frame {definition} {caption} {fallbackName} />
	{:else}
		<!-- Reserves the frame's size (16:9 stage + toolbar) until it mounts, so the page doesn't shift. -->
		<div class="not-prose" aria-hidden="true">
			<div class="aspect-video w-full rounded-sm bg-gray-100 dark:bg-gray-800"></div>
			<div class="h-[52px] sm:h-[44px]"></div>
		</div>
	{/if}
	<noscript><blockquote>Please enable JavaScript to see this presentation.</blockquote></noscript>
	{#if caption}
		<figcaption class="text-center">{caption}</figcaption>
	{/if}
</figure>

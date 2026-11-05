<script lang="ts" module>
	/**
	 * What a markdown script embed (`![caption](/path/demo.js)`) must export:
	 *
	 *     export default function mount(container, { caption }) {
	 *         // build the demo's DOM inside `container`
	 *         return () => { // optional: stop timers, listeners, ... };
	 *     }
	 *
	 * The module is imported once per page load and cached by the browser, so
	 * all state lives inside `mount`, never at module top level: `mount` runs
	 * again on every visit during client-side navigation. Query elements through
	 * `container`, not `document`, so two embeds can't collide on ids.
	 */
	export type ScriptEmbedMount = (
		container: HTMLElement,
		options: { caption: string }
	) => void | (() => void);
</script>

<script lang="ts">
	interface Props {
		href: string;
		/** Optional caption; also handed to the script for its accessible name. */
		caption?: string;
	}

	let { href, caption = '' }: Props = $props();
	let container: HTMLDivElement | undefined = $state();

	// Runs in the browser only, after hydration of a prerendered page and after
	// every client-side navigation alike; the cleanup runs when leaving the page.
	$effect(() => {
		const el = container;
		const src = href;
		const options = { caption };
		if (!el) return;

		let cancelled = false;
		let cleanup: (() => void) | undefined;

		import(/* @vite-ignore */ src)
			.then((mod: { default?: ScriptEmbedMount }) => {
				if (cancelled) return;
				if (typeof mod.default !== 'function') {
					console.error(`Script embed ${src} has no default export to mount.`);
					return;
				}
				const result = mod.default(el, options);
				if (typeof result === 'function') cleanup = result;
			})
			.catch((ex) => console.error(`Failed to load script embed ${src}:`, ex));

		return () => {
			cancelled = true;
			cleanup?.();
			el.replaceChildren();
		};
	});
</script>

<figure class="w-full xl:w-3/4 mx-auto flex flex-col justify-center">
	<div bind:this={container} class="w-full"></div>
	<noscript><blockquote>Please enable JavaScript to see this demo.</blockquote></noscript>
	{#if caption}
		<figcaption class="text-center">{caption}</figcaption>
	{/if}
</figure>

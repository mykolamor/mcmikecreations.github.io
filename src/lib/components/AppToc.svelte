<script lang="ts">
	import { page } from '$app/state';
	import { Span } from 'flowbite-svelte';
	import tocbot from 'tocbot';
	import { BarsFromLeftOutline } from 'flowbite-svelte-icons';
	import { tick } from 'svelte';
	import { onMount } from "svelte";

	/*
None					width: 100%;
sm (640px)		max-width: 640px;
md (768px)		max-width: 768px;
lg (1024px)		max-width: 1024px;
xl (1280px)		max-width: 1280px;
2xl (1536px)	max-width: 1536px;
	 */
	let enabled = $derived(page.data.toc?.enabled ?? false);
	let windowWidth = $state(0);
	let desktop = $state(true);
	let breakpoint = $state(1024);
	let open = $state(false);
	let aside = $state<HTMLElement | undefined>(undefined);

	function initTocbot() {
		desktop = windowWidth > breakpoint;
		// TODO: has a bug when sometimes the toc headings are not highlighted correctly in the list.
		// because sometimes heading.offsetTop == 0.
		tocbot.init({
			// Where to render the table of contents.
			tocSelector: '.js-toc',
			// Where to grab the headings to build the table of contents.
			contentSelector: 'main',
			// Which headings to grab inside of the contentSelector element.
			headingSelector: 'h2, h3, h4',
			// For headings inside relative or absolute positioned containers within content.
			hasInnerContainers: true,
			// How many heading levels should not be collapsed.
			collapseDepth: 2,
			// Lower = more responsive active-link updates during scroll
			throttleTimeout: 10, // try 0, 10, 20 and compare
			// Keep enabled so tocbot tracks active section while scrolling
			disableTocScrollSync: false,
			// Callback for scroll end.
			scrollEndCallback: function (e) { if(!desktop) open = false; },
		});
		setTimeout(tocbot.refresh);
	}

	$effect(() => {
		if (!enabled) {
			tocbot.destroy();
			return;
		}

		// Rebuild TOC on in-layout route changes after the new page DOM is rendered.
		const path = page.url.pathname;
		let cancelled = false;

		void tick().then(() => {
			if (cancelled || page.url.pathname !== path) return;
			tocbot.destroy();
			initTocbot();
		});

		return () => {
			cancelled = true;
		};
	});

	onMount(() => {
		tocbot.refresh();
		return () => tocbot.destroy();
	});

	function close(event: MouseEvent) {
		if (!aside?.contains(event.target as Node)) open = false;
	}

	$effect(() => {
		if (open || desktop) {
			tocbot.refresh();
		}
	});
</script>

<svelte:window
	bind:innerWidth={windowWidth}
	onresize={() => {
		if (desktop !== (windowWidth > breakpoint)) {
			desktop = windowWidth > breakpoint;
		}
	}}
	onclick={close}
></svelte:window>

<div class={enabled ? '' : 'hidden'}>
	{#if !open && !desktop}
		<button
			class="toc-button text-gray-500 dark:text-gray-400
			bg-white/20
			hover:bg-gray-100 dark:hover:bg-gray-700
			focus:outline-hidden focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-700
			rounded-lg text-sm p-2.5"
			aria-label="Open table of contents"
			onclick={(event) => { event.stopPropagation(); event.preventDefault(); open = true; }}
		>
			<BarsFromLeftOutline class="size-5 text-gray-500 dark:text-gray-400" />
		</button>
	{/if}
	{#if open || desktop}
		<aside
			bind:this={aside}
			class:desktop={desktop}
			class:mobile={!desktop}
			class="toc py-4 bg-gray-50 border-gray-100 dark:bg-gray-800 dark:border-gray-700 divide-gray-100 dark:divide-gray-700 border rounded-lg"
		>
			<span class="ms-[1em] text-gray-900 dark:text-white font-medium">On this page:</span>
			<nav class="js-toc">
			</nav>
		</aside>
	{/if}
</div>

<style>
	@reference "../../app.css";

	aside.toc {
		box-sizing: border-box;
		height: max-content;
		overflow-wrap: break-word;
		font-size: var(--toc-font-size);
		min-width: var(--toc-min-width);
		width: var(--toc-width);
		z-index: var(--toc-z-index, 1);

		--toc-mobile-btn-padding: 0;
		--toc-active-bg: transparent;
	}

	aside.toc.desktop {
		margin: var(--toc-desktop-aside-margin, var(--toc-desktop-nav-margin));
		position: sticky;
		/*background: var(--toc-desktop-bg);*/
		max-width: var(--toc-desktop-max-width);
		top: var(--toc-desktop-sticky-top, 2em);
	}

	aside.toc.mobile {
		position: fixed;
		bottom: var(--toc-mobile-bottom, 1em);
		right: var(--toc-mobile-right, 1em);
	}

	aside.toc > nav {
		position: relative;
		max-height: var(--toc-max-height, 90vh);
		padding-inline-end: 1em;
	}

	aside.toc.mobile > nav {
      width: var(--toc-mobile-width, 18em);
	}

	:global(aside.toc > nav li) {
      cursor: pointer;
      border: var(--toc-li-border);
      border-radius: var(--toc-li-border-radius);
      margin: var(--toc-li-margin);

			margin-inline-start: 1em;
	}

  :global(aside.toc > nav a) {
			border-radius: .5rem;
			display: block;
      padding: var(--toc-li-padding, 2pt 4pt);
			@apply py-[0.2922rem] md:py-[0.1672rem] px-[1.0844rem] md:px-[0.3344rem];

			font-weight: 500;
			/*padding-inline-start: .75rem;*/
			/*padding-inline-end: 1rem;*/
  }

	button.toc-button {
      border: none;
      bottom: var(--toc-mobile-btn-bottom, 1rem);
      cursor: pointer;
      font: var(--toc-mobile-btn-font, 2em sans-serif);
      line-height: var(--toc-mobile-btn-line-height, 0);
      position: fixed;
      right: var(--toc-mobile-btn-right, 1rem);
      z-index: var(--toc-mobile-btn-z-index, 2);
      border-radius: var(--toc-mobile-btn-border-radius, 4pt);
	}

  :global(aside.toc > nav a.node-name--H2) {
			font-size: 2ex;
  }

  :global(aside.toc > nav a.node-name--H3) {
			font-size: 1.8ex;
  }

  :global(aside.toc > nav a.node-name--H4) {
			font-size: 1.6ex;
  }

  :global(aside.toc > nav a.node-name--H5) {
			font-size: 1.6ex;
  }

  :global(aside.toc > nav a.node-name--H6) {
			font-size: 1.6ex;
  }

  :global(aside.toc > nav a) {
      @apply text-gray-900 hover:text-primary-700 focus-within:text-primary-700
      bg-transparent hover:bg-gray-100
      focus-within:ring-4 focus-within:outline-hidden
      focus-within:ring-gray-200 rounded-lg;
  }

  :global(html.dark aside.toc > nav a) {
      @apply text-gray-400 hover:bg-transparent focus-within:text-white hover:text-white focus-within:ring-gray-700;
  }

  :global(aside.toc > nav a.is-active-link) {
      @apply text-white hover:text-white
      bg-primary-700 hover:bg-primary-800 focus-within:ring-4 focus-within:outline-hidden focus-within:ring-primary-300 rounded-lg;
	}

  :global(html.dark aside.toc > nav a.is-active-link) {
      @apply text-white bg-primary-600 hover:bg-primary-700 focus-within:ring-primary-800;
	}
</style>

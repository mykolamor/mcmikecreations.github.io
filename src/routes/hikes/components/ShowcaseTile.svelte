<script lang="ts">
    import type { Snippet } from 'svelte';
    import { type ClassNameValue, twMerge } from 'tailwind-merge';

    /*
     * One panel of a ShowcaseGrid. `x`/`y` are its column/row spans on the
     * widest tier (x ≤ the grid's --cols). Wide tiles (x > y) put the image
     * beside the text, giving it a y:y share; square and tall tiles stack it.
     */
    interface Props {
        title: string;
        img: string;
        alt: string;
        href?: string;
        x?: number;
        y?: number;
        children: Snippet;
        class?: ClassNameValue;
    }

    let { title, img, alt, href, x = 1, y = 1, children, class: classProps }: Props = $props();
    const shape = $derived(x > y ? 'wide' : 'stacked');
</script>

<svelte:element
    this={href ? 'a' : 'div'}
    {href}
    class={twMerge(
        'tile group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm',
        href && 'hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
        classProps
    )}
    style:--x={x}
    style:--y={y}
    data-shape={shape}
>
    <div class="tile-media">
        <img
            src={img}
            {alt}
            loading="lazy"
            decoding="async"
            class="transition-transform duration-500 group-hover:scale-105"
        />
    </div>
    <div class="tile-body p-6 text-gray-700 dark:text-gray-400">
        <h3 class="mb-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h3>
        {@render children()}
    </div>
</svelte:element>

<style>
    .tile {
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
    }

    /* The image never sizes the tile: it fills whatever box the layout gives it. */
    .tile-media {
        position: relative;
        aspect-ratio: 4 / 3;
        overflow: hidden;
    }

    .tile-media img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .tile-body :global(p) {
        line-height: 1.25;
        text-align: justify;
        hyphens: auto;
    }

    .tile-body :global(p + p) {
        margin-top: 1rem;
    }

    @container showcase (min-width: 40rem) {
        .tile {
            flex-direction: row;
        }

        .tile-media {
            flex: none;
            width: 50%;
            aspect-ratio: auto;
        }

        .tile-body {
            flex: 1;
            min-width: 0;
            align-self: center;
        }
    }

    @container showcase (min-width: 64rem) {
        .tile {
            grid-column: span var(--x);
            grid-row: span var(--y);
        }

        .tile[data-shape='wide'] .tile-media {
            width: calc(100% * var(--y) / var(--x));
        }

        .tile[data-shape='stacked'] {
            flex-direction: column;
        }

        .tile[data-shape='stacked'] .tile-media {
            flex: 1 1 auto;
            width: 100%;
            min-height: 10rem;
        }

        .tile[data-shape='stacked'] .tile-body {
            align-self: stretch;
        }
    }
</style>

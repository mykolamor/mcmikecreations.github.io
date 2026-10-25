<script lang="ts">
    import type { Snippet } from 'svelte';

    /*
     * Gallery grid for ShowcaseTile children. Layout tiers are driven by the
     * grid's own width (container queries), not the viewport:
     *   < 40rem  single column, tiles stacked (image on top), natural height
     *   ≥ 40rem  single column, every tile a 2:1 split card (image | text)
     *   ≥ 64rem  --cols columns with square cells; tiles take their x×y spans
     * Rows are at least one cell tall and grow when text needs more room.
     */
    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

<div class="showcase">
    <div class="showcase-grid">
        {@render children()}
    </div>
</div>

<style>
    .showcase {
        container: showcase / inline-size;
    }

    .showcase-grid {
        --gap: 1rem;
        display: grid;
        gap: var(--gap);
        grid-template-columns: minmax(0, 1fr);
        grid-auto-flow: row dense;
    }

    @container showcase (min-width: 40rem) {
        .showcase-grid {
            grid-auto-rows: minmax(50cqi, auto);
        }
    }

    @container showcase (min-width: 64rem) {
        .showcase-grid {
            --cols: 3;
            grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
            grid-auto-rows: minmax(calc((100cqi - (var(--cols) - 1) * var(--gap)) / var(--cols)), auto);
        }
    }
</style>

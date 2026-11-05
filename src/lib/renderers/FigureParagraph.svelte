<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tokens?: { type: string; text?: string }[];
		children?: Snippet;
	}

	let { tokens = [], children }: Props = $props();

	// A paragraph holding nothing but images renders as their figures alone:
	// `<figure>` inside `<p>` is invalid HTML, so the browser would split the
	// prerendered `<p>` apart and hydration would no longer match it.
	const onlyMedia = $derived(
		tokens.length > 0 &&
			tokens.some((t) => t.type === 'image') &&
			tokens.every((t) => t.type === 'image' || t.type === 'br' || (t.type === 'text' && !t.text?.trim()))
	);
</script>

{#if onlyMedia}
	{@render children?.()}
{:else}
	<p>{@render children?.()}</p>
{/if}

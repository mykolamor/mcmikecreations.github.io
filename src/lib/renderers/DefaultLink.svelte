<script lang="ts">
	interface Props {
		href?: string;
		title?: string | null | undefined;
		children?: import('svelte').Snippet;
	}

	let { href = '', title = undefined, children }: Props = $props();

	// `/404/` marks a post that doesn't exist yet. Linking it would send readers
	// and crawlers to a dead end, so it renders as plain text, as in the hike
	// renderer; writing that post later only means changing the URL.
	const placeholder = $derived(/^\/404\/?$/.test(href.trim()));
</script>

{#if placeholder}
	<span translate="no">{@render children?.()}</span>
{:else}
	<a {href} {title}>{@render children?.()}</a>
{/if}

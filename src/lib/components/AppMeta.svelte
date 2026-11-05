<script lang="ts">
	import { onMount } from 'svelte';
	import resume from '$lib/data/resume.json';
	import { page } from '$app/state';

	interface Props {
		title?: string;
		hasBaseTitle?: boolean;
		description?: string;
		image?: string;
		shouldIndex?: boolean;
		type?: string | 'website' | 'article';
		tags?: string[];
		canonical?: string;
		[key: `article-${string}`]: string | undefined;
	}

	let {
		title,
		hasBaseTitle = true,
		description,
		image,
		shouldIndex = true,
		type = 'website',
		tags = [],
		canonical,
		...otherProps
	}: Props = $props();
	const oldUrl = page.url;
	let fullImageUrl = $derived(image ? (image.startsWith('http') ? image : page.url.origin + image) : image);
	let canonicalUrl = $state(new URL(oldUrl.origin.replace('www.', '') + oldUrl.pathname));
	const canonicalHref = $derived(
		canonical ? oldUrl.origin.replace('www.', '') + canonical : canonicalUrl.toString()
	);
	const titleBase = resume.basics.name;

	onMount(() => {
		canonicalUrl.search = oldUrl.search;
	});
</script>

<svelte:head>
	<title>{hasBaseTitle ? ((title ? (title + ' | ') : '') + titleBase) : (title ? title : titleBase)}</title>
	<link rel="canonical" href={canonicalHref} />
	{#if description}
		<meta name="description" content={description}>
	{/if}
	{#if shouldIndex}
		<meta name="robots" content="index, follow">
	{:else}
		<meta name="robots" content="noindex, nofollow">
	{/if}
	<meta name="author" content={resume.basics.name}>
	{#if tags && tags.length > 0}
		<meta name="keywords" content={tags.join(', ')}>
	{/if}

	<meta property="og:site_name" content={resume.basics.name}>
	<meta property="og:type" content={type}>
	<meta property="og:url" content={canonicalUrl.toString()}>
	<meta property="og:title" content={title ?? titleBase}>
	{#if description}
		<meta property="og:description" content={description}>
	{/if}
	{#if fullImageUrl}
		<meta property="og:image" content={fullImageUrl}>
	{/if}
	<meta property="og:locale" content="en_US">

	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:url" content={canonicalUrl.toString()}>
	<meta name="twitter:title" content={title ?? titleBase}>
	{#if description}
		<meta name="twitter:description" content={description}>
	{/if}
	{#if image}
		<meta name="twitter:image" content={fullImageUrl}>
	{/if}

	{#each Object.entries(otherProps).filter(([, value]) => value != null) as [key, value] (key)}
		<meta property={key.replaceAll('-', ':')} content={value}>
	{/each}
</svelte:head>

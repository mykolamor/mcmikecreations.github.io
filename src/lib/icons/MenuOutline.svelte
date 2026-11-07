<script lang="ts">
	import { getContext } from 'svelte';
	import { twMerge } from 'tailwind-merge';
	import type { BaseProps, Props, Size } from 'flowbite-svelte-icons/types';

	const ctx: BaseProps = getContext('iconCtx') ?? {};
	const sizes = {
		xs: 'w-3 h-3',
		sm: 'w-4 h-4',
		md: 'w-5 h-5',
		lg: 'w-6 h-6',
		xl: 'w-8 h-8'
	};

	let {
		size,
		width,
		height,
		color = ctx.color || 'currentColor',
		title,
		desc,
		class: className,
		ariaLabel,
		role = ctx.role || 'img',
		...restProps
	}: Props = $props();

	const effectiveSize: Size = $derived(
		width === undefined && height === undefined
			? (size ?? (ctx.size as Size | undefined) ?? 'md')
			: 'md'
	);

	const sizeClass = $derived(
		width === undefined && height === undefined ? sizes[effectiveSize] : undefined
	);

	const ariaDescribedby = $derived(`${title?.id || ''} ${desc?.id || ''}`.trim());
	const hasDescription = $derived(!!(title?.id || desc?.id));
	const isLabeled = $derived(!!ariaLabel || hasDescription);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	{color}
	{width}
	{height}
	{...restProps}
	class={twMerge('shrink-0', sizeClass, `${className ?? ''}`)}
	role={isLabeled ? role : undefined}
	aria-label={ariaLabel}
	aria-describedby={hasDescription ? ariaDescribedby : undefined}
	aria-hidden={!isLabeled}
>
	{#if title?.id && title.title}
		<title id={title.id}>{title.title}</title>
	{/if}
	{#if desc?.id && desc.desc}
		<desc id={desc.id}>{desc.desc}</desc>
	{/if}
	<path d="M4 6h16M4 12h16M4 18h16" />
</svg>
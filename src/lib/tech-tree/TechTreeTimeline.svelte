<!--
	One SmackDB tech tree timeline (`$lib/tech-tree/layout`): era headers over column bands, an SVG layer of
	"builds on" arrows, and a card per post. A published post links to it; a draft is a locked "coming soon" card.
	Wider than the column, the timeline scrolls sideways inside its own box; the page never does.
-->
<script lang="ts">
	import { LockSolid } from 'flowbite-svelte-icons';
	import { t } from '$lib/i18n/strings';
	import type { Lang } from '$lib/i18n/languages';
	import { edgePath, type Box, type LaidOutNode, type TimelineLayout } from './layout';
	import { nodeTitle } from './model';

	interface Props {
		layout: TimelineLayout;
		lang: Lang;
	}

	let { layout, lang }: Props = $props();

	const NODE_W = 208;
	const NODE_H = 64;
	const COL_GAP = 56;
	const ROW_GAP = 20;
	const HEAD_H = 36;
	const PAD = 16;

	const cell = (col: number, row: number): Box => ({
		x: col * (NODE_W + COL_GAP) + COL_GAP / 2,
		y: HEAD_H + PAD + row * (NODE_H + ROW_GAP),
		w: NODE_W,
		h: NODE_H
	});
	const box = (n: LaidOutNode): Box => cell(n.col, n.gridRow);

	const width = $derived(layout.cols * (NODE_W + COL_GAP));
	const height = $derived(HEAD_H + PAD * 2 + Math.max(layout.rows, 1) * (NODE_H + ROW_GAP) - ROW_GAP);
	const byAnchor = $derived(new Map(layout.nodes.map((n) => [n.anchor, n])));
	const headingId = $derived(`tech-tree-${layout.key}`);

	function dependsOn(n: LaidOutNode): string | undefined {
		const deps = layout.edges.filter((e) => e.to === n.anchor).map((e) => nodeTitle(byAnchor.get(e.from)!, lang));
		return deps.length === 0 ? undefined : `${t(lang, 'techTree.buildsOn')}: ${deps.join(', ')}`;
	}
</script>

<section aria-labelledby={headingId} class="mb-12">
	<h2 id={headingId} class="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
		{t(lang, `techTree.timelines.${layout.key}.name`)}
	</h2>
	<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
		<div class="relative" style:width="{width}px" style:height="{height}px">
			{#each layout.eras as era, i (era.key)}
				<div
					class="absolute top-0 bottom-0 {i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/60' : ''} border-e border-dashed border-gray-200 dark:border-gray-700 last:border-e-0"
					style:left="{era.colStart * (NODE_W + COL_GAP)}px"
					style:width="{era.colSpan * (NODE_W + COL_GAP)}px"
				>
					<div
						class="flex items-center justify-center text-xs font-semibold uppercase tracking-wider text-primary-700 dark:text-primary-400 border-b border-gray-200 dark:border-gray-700"
						style:height="{HEAD_H}px"
					>
						{t(lang, `techTree.timelines.${layout.key}.eras.${era.key}`)}
					</div>
				</div>
			{/each}

			<svg class="absolute inset-0 text-gray-400 dark:text-gray-500 pointer-events-none" {width} {height} aria-hidden="true">
				<defs>
					<marker id="{headingId}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
						<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
					</marker>
				</defs>
				{#each layout.edges as e (`${e.from}>${e.to}`)}
					<path
						d={edgePath(box(byAnchor.get(e.from)!), box(byAnchor.get(e.to)!), e.via.map((v) => cell(v.col, v.row)))}
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						marker-end="url(#{headingId}-arrow)"
					/>
				{/each}
			</svg>

			{#each layout.nodes as n (n.anchor)}
				{@const b = box(n)}
				{@const title = nodeTitle(n, lang)}
				{#if n.href}
					<a
						href={n.href}
						title={dependsOn(n)}
						class="absolute flex flex-col justify-center gap-0.5 rounded-lg border-2 border-primary-600 dark:border-primary-500 bg-white dark:bg-gray-800 px-3 shadow-sm hover:bg-primary-50 dark:hover:bg-gray-700 hover:shadow-md transition no-underline"
						style:left="{b.x}px"
						style:top="{b.y}px"
						style:width="{b.w}px"
						style:height="{b.h}px"
					>
						<span class="text-sm font-semibold leading-tight line-clamp-2 text-gray-900 dark:text-white">{title}</span>
						{#if n.year !== null}<span class="text-xs text-gray-500 dark:text-gray-400">{n.year}</span>{/if}
					</a>
				{:else}
					<div
						aria-disabled="true"
						title={dependsOn(n)}
						class="absolute flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/80 px-3 text-gray-500 dark:text-gray-400"
						style:left="{b.x}px"
						style:top="{b.y}px"
						style:width="{b.w}px"
						style:height="{b.h}px"
					>
						<LockSolid class="shrink-0 size-4" ariaLabel={t(lang, 'techTree.comingSoon')} />
						<span class="flex flex-col gap-0.5 min-w-0">
							<span class="text-sm font-semibold leading-tight line-clamp-2">{title}</span>
							<span class="text-xs">
								{t(lang, 'techTree.comingSoon')}{#if n.year !== null}&ensp;·&ensp;{n.year}{/if}
							</span>
						</span>
					</div>
				{/if}
			{/each}
		</div>
	</div>
</section>

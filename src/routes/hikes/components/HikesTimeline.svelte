<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/strings';

	const GRID_ROWS = 6;

	type WeekHike = { name: string; route: string; hasBlog: boolean };
	type WeekData = { year: number; weekIndex: number; label: string; hikes: WeekHike[] };

	export let weeks: WeekData[];

	function generateColumns(ws: WeekData[]) {
		const columns: WeekData[][] = [];
		for (let i = 0; i < ws.length; i += GRID_ROWS) {
			columns.push(ws.slice(i, i + GRID_ROWS));
		}
		return columns;
	}

	$: allColumns = generateColumns(weeks);

	function getIntensityClass(hikes: WeekHike[]) {
		const count = hikes.length;
		if (count === 0) return 'bg-gray-200 dark:bg-gray-700';
		if (!hikes.some(h => h.hasBlog)) return 'bg-sky-400 dark:bg-sky-700';
		if (count === 1) return 'bg-emerald-300 dark:bg-emerald-800';
		if (count === 2) return 'bg-emerald-400 dark:bg-emerald-600';
		if (count === 3) return 'bg-emerald-600 dark:bg-emerald-500';
		return 'bg-emerald-700 dark:bg-emerald-400';
	}

	let scrollContainer: HTMLDivElement;

	onMount(() => {
		if (scrollContainer) {
			scrollContainer.scrollLeft = scrollContainer.scrollWidth;
		}
	});

	let activeWeek: WeekData | null = null;
	let popoverStyle = '';

	function togglePopover(event: MouseEvent | KeyboardEvent, week: WeekData) {
		event.stopPropagation();
		if (activeWeek === week) {
			activeWeek = null;
		} else {
			activeWeek = week;
			const target = event.currentTarget as HTMLElement;
			const rect = target.getBoundingClientRect();
			const left = rect.left + rect.width / 2;
			const top = rect.top - 8;
			popoverStyle = `left: ${left}px; top: ${top}px; transform: translate(-50%, -100%); pointer-events: auto;`;
		}
	}

	function closePopover() {
		activeWeek = null;
	}
</script>

<svelte:window on:click={closePopover} on:scroll={closePopover} on:resize={closePopover} />

<div bind:this={scrollContainer} on:scroll={closePopover} class="w-full text-sm overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
	<div class="flex flex-row gap-1.5 min-w-max mt-5 mx-1">
		{#each allColumns as col, i}
			<div class="flex flex-col gap-1.5">
				<div class="h-6 relative">
					{#if i === 0 || col[0].year !== allColumns[i - 1][0].year}
						<span class="absolute left-0 bottom-1 font-semibold text-gray-700 dark:text-gray-300 m-0 z-10 whitespace-nowrap">{col[0].year}</span>
					{/if}
				</div>
				{#each col as week}
					<div
						id="week-{week.year}-{week.weekIndex}"
						class="w-4 h-4 rounded-xs {getIntensityClass(week.hikes)} transition-colors hover:ring-2 hover:ring-gray-400 dark:hover:ring-gray-500 cursor-pointer"
						role="button"
						tabindex="0"
						aria-label={t('en', 'web.weekHikes', { label: week.label, count: week.hikes.length })}
						on:click={(e) => week.hikes.length > 0 && togglePopover(e, week)}
						on:keydown={(e) => e.key === 'Enter' && week.hikes.length > 0 && togglePopover(e, week)}
					></div>
				{/each}
			</div>
		{/each}
	</div>
</div>

{#if activeWeek}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="fixed z-[9999] w-64 p-3 bg-white rounded-lg shadow-xl dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-light text-gray-500 dark:text-gray-400"
		style={popoverStyle}
		on:click={(e) => e.stopPropagation()}
	>
		<div class="font-medium mb-2 border-b pb-2 dark:border-gray-700 text-gray-900 dark:text-white">{t('en', 'web.week', { label: activeWeek.label })}</div>
		<ul class="list-disc pl-4 m-0 space-y-1 text-left">
			{#each activeWeek.hikes as hike}
				<li class="break-words">
					<a href={`${hike.route}`} class="text-primary-600 dark:text-primary-500 hover:underline">{hike.name}</a>
				</li>
			{/each}
		</ul>
		<div class="absolute w-3 h-3 bg-white border-b border-r border-gray-200 dark:border-gray-700 dark:bg-gray-800 transform rotate-45 left-1/2 -bottom-1.5 -ml-1.5 shadow-xs rounded-xs"></div>
	</div>
{/if}
<script lang="ts">
	// The facts layer's tiles in the post's title card, beside the computed
	// ones: difficulty, exposure, fitness, season and car-free access. Renders
	// `display: contents`, so the tiles join the card's own flex row.
	import { ShieldOutline, EyeOutline, FireOutline, CalendarMonthOutline, TruckOutline } from 'flowbite-svelte-icons';
	import type { HikeAuthoredFacts, Lang } from '$lib/hikes/facts-schema';
	import { enumLabel, formatFerrata, formatMonths, hardestFerrata, label, seasonMonths } from '$lib/hikes/facts-format';
	import StatTile from './StatTile.svelte';

	interface Props {
		facts: HikeAuthoredFacts;
		lang: Lang;
	}

	let { facts, lang }: Props = $props();

	const d = $derived(facts.difficulty);
	const ferrata = $derived(hardestFerrata(d?.viaFerrata));
	const grade = $derived(
		[d?.sac, ferrata ? formatFerrata(lang, ferrata) : '', d?.climbing?.grade]
			.filter(Boolean)
			.join(' · ')
	);
	const season = $derived(formatMonths(lang, seasonMonths(facts.season)));
</script>

<div class="contents" lang={lang}>
	{#if grade}
		<StatTile
			icon={ShieldOutline}
			label={label(lang, 'difficulty')}
			value={grade}
			hint={d?.sacSource === 'computed' ? `${label(lang, 'sac')}: ${label(lang, 'sacComputed')}` : undefined}
		/>
	{/if}
	{#if d?.exposure}
		<StatTile icon={EyeOutline} label={label(lang, 'exposure')} value={enumLabel(lang, 'level4', d.exposure.level)} />
	{/if}
	{#if d?.fitness}
		<StatTile icon={FireOutline} label={label(lang, 'fitness')} value={`${d.fitness} ${label(lang, 'fitnessOf')}`} />
	{/if}
	{#if season}
		<StatTile icon={CalendarMonthOutline} label={label(lang, 'season')} value={season} />
	{/if}
	{#if facts.access?.carFree}
		<!-- Only the answer: a journey is often train + bus + bus + a walk, which no
		     tile can hold. The connections are listed under "Getting there". -->
		<StatTile
			icon={TruckOutline}
			label={label(lang, 'carFree')}
			value={enumLabel(lang, 'carFree', facts.access.carFree)}
			hint={label(lang, 'access')}
			href="#facts-access"
		/>
	{/if}
</div>

<script lang="ts">
	// The safety half of the facts layer, above the narrative: hazards by
	// severity, bailout points, what not to copy, and the conditions on the day.
	import { ExclamationCircleOutline, LifeSaverOutline, BanOutline, SunOutline } from 'flowbite-svelte-icons';
	import { textIn, type HikeAuthoredFacts, type Lang } from '$lib/hikes/facts-schema';
	import { enumLabel, formatBailoutWhere, formatMonths, formatRouteStats, label } from '$lib/hikes/facts-format';
	import FactsPlace from './FactsPlace.svelte';
	import FactsSpan from './FactsSpan.svelte';

	interface Props {
		facts: HikeAuthoredFacts;
		lang: Lang;
	}

	let { facts, lang }: Props = $props();

	const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
	const SEVERITY_CLASS = {
		high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
		medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
		low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
	};

	const hazards = $derived(
		[...(facts.hazards ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity ?? 'medium'] - SEVERITY_ORDER[b.severity ?? 'medium'])
	);
	const c = $derived(facts.conditions);
	const show = $derived(hazards.length > 0 || !!facts.bailouts?.length || !!facts.deviations?.length || !!c || !!facts.summary);
</script>

{#if show}
	<section class="not-prose mb-8 flex flex-col gap-4 text-base" {lang} aria-label={label(lang, 'safety')}>
		{#if facts.summary}
			<p class="text-lg text-gray-700 dark:text-gray-300">{textIn(facts.summary, lang)}</p>
		{/if}

		{#if hazards.length || facts.bailouts?.length || facts.deviations?.length}
			<div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-gray-800 p-4 flex flex-col gap-4">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white">{label(lang, 'safety')}</h2>

				{#if hazards.length}
					<div>
						<h3 class="flex items-center gap-2 font-semibold mb-2"><ExclamationCircleOutline class="w-5 h-5 text-amber-600" />{label(lang, 'hazards')}</h3>
						<ul class="flex flex-col gap-2">
							{#each hazards as h}
								<li class="flex flex-wrap items-baseline gap-x-2">
									<span class="text-xs font-medium px-2 py-0.5 rounded {SEVERITY_CLASS[h.severity ?? 'medium']}">{enumLabel(lang, 'severity', h.severity ?? 'medium')}</span>
									<span class="font-medium">{enumLabel(lang, 'hazard', h.kind, h.label)}</span>
									{#if h.at || h.from || h.to}
										<span class="text-gray-700 dark:text-gray-300"><FactsSpan {lang} at={h.at} from={h.from} to={h.to} /></span>
									{/if}
									{#if h.season?.length}
										<span class="text-sm text-gray-500 dark:text-gray-400">({formatMonths(lang, h.season)})</span>
									{/if}
									{#if h.note}
										<span class="basis-full text-gray-600 dark:text-gray-400">{textIn(h.note, lang)}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if facts.bailouts?.length}
					<div>
						<h3 class="flex items-center gap-2 font-semibold mb-2"><LifeSaverOutline class="w-5 h-5 text-amber-600" />{label(lang, 'bailouts')}</h3>
						<ol class="flex flex-col gap-2">
							{#each facts.bailouts as b}
								{@const where = formatBailoutWhere(lang, b)}
								<li>
									<FactsPlace place={b.at} {lang} km />
									{#if where.length}
										<span class="text-gray-700 dark:text-gray-300">
											→ {where.join(', ')}
										</span>
									{/if}
									{#if b.last}
										<span class="text-xs font-medium px-2 py-0.5 rounded {SEVERITY_CLASS.high}">{label(lang, 'lastChance')}</span>
									{/if}
									{#if b.note}<div class="text-gray-600 dark:text-gray-400">{textIn(b.note, lang)}</div>{/if}
									{#if b.route}
										<div class="text-sm text-gray-500 dark:text-gray-400" translate="no">
											{label(lang, 'bailoutRoute')}: {formatRouteStats(lang, b.route).join(' · ')}{' · '}<a class="underline" href={b.route.url} download={b.route.url.slice(b.route.url.lastIndexOf('/') + 1)}>{label(lang, 'gpx')}</a>
										</div>
									{/if}
								</li>
							{/each}
						</ol>
					</div>
				{/if}

				{#if facts.deviations?.length}
					<div>
						<h3 class="flex items-center gap-2 font-semibold mb-2"><BanOutline class="w-5 h-5 text-red-600" />{label(lang, 'deviations')}</h3>
						<ul class="flex flex-col gap-2">
							{#each facts.deviations as dv}
								<li>
									{#if dv.kind}<span class="font-medium">{enumLabel(lang, 'deviation', dv.kind)}{#if dv.at}{' · '}<FactsPlace place={dv.at} {lang} />{/if}:</span>{' '}{/if}
									{textIn(dv.note, lang)}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<p class="text-sm text-gray-600 dark:text-gray-400">{label(lang, 'disclaimer')}</p>
			</div>
		{/if}

		{#if c}
			<details class="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
				<summary class="cursor-pointer font-semibold flex items-center gap-2"><SunOutline class="w-5 h-5 text-primary-600" />{label(lang, 'conditions')}</summary>
				<dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
					{#if c.weather?.length}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'weather')}</dt><dd>{c.weather.map((w) => enumLabel(lang, 'weather', w)).join(', ')}</dd>{/if}
					{#if c.temp}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'temp')}</dt><dd translate="no">{[c.temp.min, c.temp.max].filter((x) => x != null).map((x) => `${x} °C`).join(' – ')}</dd>{/if}
					{#if c.visibility}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'visibility')}</dt><dd>{enumLabel(lang, 'visibility', c.visibility)}</dd>{/if}
					{#if c.snowLine != null}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'snowLine')}</dt><dd translate="no">{c.snowLine} m</dd>{/if}
					{#if c.traction}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'traction')}</dt><dd>{enumLabel(lang, 'traction', c.traction)}</dd>{/if}
					{#if c.trail?.length}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'trail')}</dt><dd>{c.trail.map((t) => enumLabel(lang, 'trail', t)).join(', ')}</dd>{/if}
					{#if c.crowding}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'crowding')}</dt><dd>{enumLabel(lang, 'crowding', c.crowding)}</dd>{/if}
					{#if c.start}<dt class="text-gray-500 dark:text-gray-400">{label(lang, 'started')}</dt><dd><span translate="no">{c.start}</span>{#if c.why}: {textIn(c.why, lang)}{/if}</dd>{/if}
				</dl>
				{#if c.note}<p class="mt-2 text-gray-700 dark:text-gray-300">{textIn(c.note, lang)}</p>{/if}
			</details>
		{/if}
	</section>
{/if}

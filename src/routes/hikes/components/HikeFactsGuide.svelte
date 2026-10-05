<script lang="ts">
	// The planning half of the facts layer, below the narrative: route and
	// difficulty details, getting there, "plan your version", and sources.
	import {
		MapPinAltOutline, TruckOutline, ClipboardListOutline, BookOpenOutline,
		GlassWaterDropletOutline, MobilePhoneOutline, HomeOutline, TicketOutline
	} from 'flowbite-svelte-icons';
	import { textIn, GEAR_NEED, type HikeAuthoredFacts, type Lang, type Text } from '$lib/hikes/facts-schema';
	import {
		enumLabel, formatChecked, formatClimb, formatFerrata, formatGrades, formatMinutes, formatMonths,
		formatPrices, formatWater, formatWindow, label
	} from '$lib/hikes/facts-format';
	import { getDistance } from '$lib/hikes/build-statistics';
	import FactsPlace from './FactsPlace.svelte';
	import FactsSpan from './FactsSpan.svelte';

	interface Props {
		facts: HikeAuthoredFacts;
		lang: Lang;
		/** Titles of the posts that alternatives and variants link to, by slug. */
		linkedPosts?: Record<string, string>;
	}

	let { facts, lang, linkedPosts = {} }: Props = $props();

	const t = (x: Text | undefined) => textIn(x, lang);
	const checked = (own?: string, parent?: string) => formatChecked(lang, own ?? parent ?? facts.checked);
	const postHref = (link: string) => (/^https?:\/\//.test(link) || link.startsWith('/') ? link : `/hikes/${link}/`);
	const postTitle = (link: string) => linkedPosts[link] ?? link;

	const d = $derived(facts.difficulty);
	const r = $derived(facts.route);
	const a = $derived(facts.access);
	const p = $derived(facts.plan);
	const s = $derived(facts.suitability);

	const hasRoute = $derived(
		!!(d?.note || d?.sections?.length || d?.viaFerrata?.length || d?.climbing || d?.winter || r || facts.season ||
			facts.navigation || facts.legs?.length || facts.water?.length || facts.signal?.length)
	);
	const hasAccess = $derived(!!(a || facts.permits?.length || facts.rules?.length || facts.stops?.length || facts.drones || facts.protectedAreas));
	const hasPlan = $derived(!!(p || s));
	const gearByNeed = $derived(
		GEAR_NEED.map((need) => ({ need, items: (p?.gear ?? []).filter((g) => (g.need ?? 'essential') === need) })).filter(
			(g) => g.items.length > 0
		)
	);

	const h2 = 'flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white mb-3';
	const h3 = 'font-semibold mt-4 mb-2';
	const dt = 'text-gray-500 dark:text-gray-400';
	const muted = 'text-gray-600 dark:text-gray-400';
	const meta = 'text-sm text-gray-500 dark:text-gray-400';
</script>

<div class="not-prose flex flex-col gap-8 mt-8 text-base" {lang}>
	{#if hasRoute}
		<section aria-labelledby="facts-route">
			<h2 id="facts-route" class={h2}><MapPinAltOutline class="w-6 h-6 text-primary-600" />{label(lang, 'route')}</h2>
			<dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
				{#if d?.sac}
					<dt class={dt}>{label(lang, 'sac')}</dt>
					<dd><span translate="no" class="font-semibold">{d.sac}</span>{#if d.sacSource === 'computed'}{' '}<span class={meta}>({label(lang, 'sacComputed')})</span>{/if}{#if d.note}{' — '}{t(d.note)}{/if}</dd>
				{/if}
				{#if d?.climbing}
					<dt class={dt}>{label(lang, 'climbing')}</dt>
					<dd><span translate="no" class="font-semibold">{formatClimb(lang, d.climbing)}</span>{#if d.climbing.note}{' — '}{t(d.climbing.note)}{/if}</dd>
				{/if}
				{#if d?.exposure}
					<dt class={dt}>{label(lang, 'exposure')}</dt>
					<dd>{enumLabel(lang, 'level4', d.exposure.level)}{#if d.exposure.note}{' — '}{t(d.exposure.note)}{/if}</dd>
				{/if}
				{#if d?.fitness}
					<dt class={dt}>{label(lang, 'fitness')}</dt>
					<dd>{d.fitness} {label(lang, 'fitnessOf')}</dd>
				{/if}
				{#if facts.season}
					<dt class={dt}>{label(lang, 'season')}</dt>
					<dd>
						{#if facts.season.best?.length}{label(lang, 'best')}: {formatMonths(lang, facts.season.best)}{/if}{#if facts.season.possible?.length}{facts.season.best?.length ? '; ' : ''}{label(lang, 'possible')}: {formatMonths(lang, facts.season.possible)}{/if}{#if facts.season.window}{' '}({formatWindow(lang, facts.season.window)}){/if}{#if facts.season.note}{' — '}{t(facts.season.note)}{/if}
					</dd>
				{/if}
				{#if r?.start}<dt class={dt}>{label(lang, 'start')}</dt><dd><FactsPlace place={r.start} {lang} /></dd>{/if}
				{#if r?.end}<dt class={dt}>{label(lang, 'end')}</dt><dd><FactsPlace place={r.end} {lang} /></dd>{/if}
				{#if r?.type}<dt class={dt}>{label(lang, 'routeType')}</dt><dd>{enumLabel(lang, 'routeType', r.type)}</dd>{/if}
				{#if r?.terrain?.length}<dt class={dt}>{label(lang, 'terrain')}</dt><dd>{r.terrain.map((x) => enumLabel(lang, 'terrain', x)).join(', ')}</dd>{/if}
				{#if r?.shade}<dt class={dt}>{label(lang, 'shade')}</dt><dd>{enumLabel(lang, 'level4', r.shade)}</dd>{/if}
				{#if r?.trails?.length}<dt class={dt}>{label(lang, 'trails')}</dt><dd translate="no">{r.trails.join(', ')}</dd>{/if}
				{#if r?.peaks?.length}
					<dt class={dt}>{label(lang, 'peaks')}</dt>
					<dd>{#each r.peaks as peak, i}{i > 0 ? ', ' : ''}<FactsPlace place={peak} {lang} />{/each}</dd>
				{/if}
				{#if facts.navigation?.marking || facts.navigation?.note || facts.navigation?.offline}
					<dt class={dt}>{label(lang, 'marking')}</dt>
					<dd>
						{#if facts.navigation.marking}{enumLabel(lang, 'marking', facts.navigation.marking)}{/if}{#if facts.navigation.note}{facts.navigation.marking ? ' — ' : ''}{t(facts.navigation.note)}{/if}{#if facts.navigation.offline}{' '}{label(lang, 'offline')}{/if}
					</dd>
				{/if}
			</dl>
			{#if r?.official}<p class="mt-3"><span class="font-medium">{label(lang, 'official')}:</span> {t(r.official)}</p>{/if}
			{#if facts.navigation?.spans?.length}
				<ul class="mt-2 flex flex-col gap-1">
					{#each facts.navigation.spans as sp}
						<li><FactsSpan {lang} from={sp.from} to={sp.to} />: {label(lang, 'marking').toLowerCase()} {enumLabel(lang, 'marking', sp.marking)}{#if sp.note}{' — '}{t(sp.note)}{/if}</li>
					{/each}
				</ul>
			{/if}

			{#if d?.viaFerrata?.length}
				<h3 class={h3}>{label(lang, 'viaFerrata')}</h3>
				<ul class="flex flex-col gap-2">
					{#each d.viaFerrata as f}
						<li>
							<span class="font-semibold" translate="no">{formatFerrata(lang, f)}</span>
							{#if f.name}<span class="font-medium">{t(f.name)}</span>{/if}
							{#if f.from || f.to}<span class={muted}>(<FactsSpan {lang} from={f.from} to={f.to} />)</span>{/if}
							<span class={meta}>
								{[f.length != null ? `${f.length} m ${label(lang, 'cable')}` : '', f.gain != null ? `${f.gain} m ${label(lang, 'gain')}` : '', f.time != null ? `${label(lang, 'myTime')} ${formatMinutes(lang, f.time)}` : ''].filter(Boolean).join(' · ')}
							</span>
							{#if f.note}<div class={muted}>{t(f.note)}</div>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if d?.sections?.length}
				<h3 class={h3}>{label(lang, 'sections')}</h3>
				<ul class="flex flex-col gap-1">
					{#each d.sections as sec}
						<li>
							<span class="font-semibold" translate="no">{formatGrades(lang, sec)}</span>
							<FactsSpan {lang} from={sec.from} to={sec.to} />{#if sec.note}{' — '}{t(sec.note)}{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if r?.optional?.length}
				<h3 class={h3}>{label(lang, 'optional')}</h3>
				<ul class="flex flex-col gap-1">
					{#each r.optional as o}
						<li>{#if o.name}<span class="font-medium">{t(o.name)}</span>{' '}{/if}{#if o.from || o.to}<span class={muted}>(<FactsSpan {lang} from={o.from} to={o.to} />)</span>{/if}{#if o.note}{' — '}{t(o.note)}{/if}</li>
					{/each}
				</ul>
			{/if}

			{#if d?.winter}
				<h3 class={h3}>{label(lang, 'winter')}</h3>
				<p>
					{[d.winter.snowshoe ? `${label(lang, 'snowshoe')} ${d.winter.snowshoe}` : '', d.winter.skiTour ? `${label(lang, 'skiTour')} ${d.winter.skiTour}` : '', d.winter.avalanche ? `${label(lang, 'avalanche')} ${d.winter.avalanche}` : ''].filter(Boolean).join(' · ')}{#if d.winter.note}{' — '}{t(d.winter.note)}{/if}
				</p>
			{/if}

			{#if facts.legs?.length}
				<h3 class={h3}>{label(lang, 'legs')}</h3>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
							<tr><th class="py-1 pr-3">{label(lang, 'leg')}</th><th class="py-1 pr-3">{label(lang, 'terrain')}</th><th class="py-1 pr-3">{label(lang, 'grade')}</th><th class="py-1 pr-3">{label(lang, 'marking')}</th></tr>
						</thead>
						<tbody>
							{#each facts.legs as leg}
								<tr class="border-b border-gray-100 dark:border-gray-800 align-top {leg.optional ? 'italic text-gray-500 dark:text-gray-400' : ''}">
									<td class="py-1 pr-3">→ <FactsPlace place={leg.to} {lang} km />{#if leg.optional}{' '}({label(lang, 'optionalLeg')}){/if}{#if leg.note}<div class={muted}>{t(leg.note)}</div>{/if}</td>
									<td class="py-1 pr-3">{(leg.terrain ?? []).map((x) => enumLabel(lang, 'terrain', x)).join(', ')}</td>
									<td class="py-1 pr-3" translate="no">{formatGrades(lang, leg)}</td>
									<td class="py-1 pr-3">{leg.marking ? enumLabel(lang, 'marking', leg.marking) : ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if facts.water?.length}
				<h3 class="{h3} flex items-center gap-2"><GlassWaterDropletOutline class="w-5 h-5 text-primary-600" />{label(lang, 'water')}</h3>
				<ul class="flex flex-col gap-1">
					{#each facts.water as w}
						<li>
							<FactsPlace place={w.at} {lang} km />
							<span class={muted}>{formatWater(lang, w).join(', ')}</span>
							{#if w.note}<div class={muted}>{t(w.note)}</div>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if facts.signal?.length}
				<h3 class="{h3} flex items-center gap-2"><MobilePhoneOutline class="w-5 h-5 text-primary-600" />{label(lang, 'signal')}</h3>
				<ul class="flex flex-col gap-1">
					{#each facts.signal as sg}
						<li>
							<FactsSpan {lang} from={sg.from} to={sg.to} />: <span class="font-medium">{enumLabel(lang, 'signal', sg.quality)}</span>{#if sg.network}{' '}<span class={meta} translate="no">({sg.network})</span>{/if}{#if sg.note}{' — '}{t(sg.note)}{/if}
						</li>
					{/each}
				</ul>
				<p class={meta}>{label(lang, 'signalRest')}</p>
			{/if}
		</section>
	{/if}

	{#if hasAccess}
		<section aria-labelledby="facts-access">
			<h2 id="facts-access" class={h2}><TruckOutline class="w-6 h-6 text-primary-600" />{label(lang, 'access')}</h2>
			{#if a?.carFree}<p><span class="font-medium">{label(lang, 'carFree')}:</span> {enumLabel(lang, 'carFree', a.carFree)}</p>{/if}
			{#if a?.note}<p class="mt-1">{t(a.note)}</p>{/if}

			{#if a?.transport?.length}
				<h3 class={h3}>{label(lang, 'transport')}</h3>
				<ul class="flex flex-col gap-2">
					{#each a.transport as tr}
						<li>
							<span class="font-medium">{enumLabel(lang, 'transport', tr.mode)}{#if tr.line}{' '}<span translate="no">{tr.line}</span>{/if}:</span>
							<span translate="no">{t(tr.from)}</span> → <FactsPlace place={tr.to} {lang} />
							{#if tr.direction && tr.direction !== 'both'}<span class={meta}>({enumLabel(lang, 'direction', tr.direction)})</span>{/if}
							<div class={muted}>
								{[
									tr.duration != null ? formatMinutes(lang, tr.duration) : '',
									tr.changes != null ? (tr.changes === 0 ? label(lang, 'direct') : `${tr.changes} ${label(lang, tr.changes === 1 ? 'change' : 'changes')}`) : '',
									tr.frequency ? t(tr.frequency) : '',
									tr.first ? `${label(lang, 'first')} ${tr.first}` : '',
									tr.last ? `${label(lang, 'last')} ${tr.last}` : '',
									tr.operator ?? '',
									formatPrices(lang, tr.price),
									tr.ticket ? t(tr.ticket) : ''
								].filter(Boolean).join(' · ')}
							</div>
							{#if tr.note}<div class={muted}>{t(tr.note)}</div>{/if}
							<div class={meta}>{#if tr.url}<a class="underline" href={tr.url.url} rel="noopener">{tr.url.label ? t(tr.url.label) : tr.url.url}</a>{' · '}{/if}{checked(tr.checked, a.checked)}</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if a?.lifts?.length}
				<h3 class={h3}>{label(lang, 'lifts')}</h3>
				<ul class="flex flex-col gap-2">
					{#each a.lifts as lf}
						<li>
							<span class="font-medium" translate="no">{t(lf.name)}</span>
							{#if lf.kind}<span class={muted}>({enumLabel(lang, 'lift', lf.kind)}{#if lf.direction}, {enumLabel(lang, 'liftDirection', lf.direction)}{/if})</span>{/if}
							{#if lf.from || lf.to}<FactsSpan {lang} from={lf.from} to={lf.to} />{/if}
							<div class={muted}>
								{[lf.open ? formatWindow(lang, lf.open) : '', lf.first && lf.last ? `${lf.first}–${lf.last}` : '', formatPrices(lang, lf.price)].filter(Boolean).join(' · ')}
							</div>
							{#if lf.note}<div class={muted}>{t(lf.note)}</div>{/if}
							<div class={meta}>{#if lf.url}<a class="underline" href={lf.url.url} rel="noopener">{lf.url.label ? t(lf.url.label) : lf.url.url}</a>{' · '}{/if}{checked(lf.checked, a.checked)}</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if a?.tickets?.length}
				<h3 class="{h3} flex items-center gap-2"><TicketOutline class="w-5 h-5 text-primary-600" />{label(lang, 'tickets')}</h3>
				<ul class="flex flex-col gap-2">
					{#each a.tickets as tk}
						<li>
							<span class="font-medium" translate="no">{t(tk.name)}</span>
							{#if tk.price?.length}<span class={muted}>— {formatPrices(lang, tk.price)}</span>{/if}
							{#if tk.includes?.length}<div>{label(lang, 'includes')}: {tk.includes.map(t).join(', ')}</div>{/if}
							{#if tk.validity}<div class={muted}>{label(lang, 'validity')}: {t(tk.validity)}</div>{/if}
							{#if tk.note}<div class={muted}>{t(tk.note)}</div>{/if}
							<div class={meta}>{#if tk.url}<a class="underline" href={tk.url.url} rel="noopener">{tk.url.label ? t(tk.url.label) : tk.url.url}</a>{' · '}{/if}{checked(tk.checked, a.checked)}</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if a?.parking?.length}
				<h3 class={h3}>{label(lang, 'parking')}</h3>
				<ul class="flex flex-col gap-2">
					{#each a.parking as pk}
						<li>
							{#if pk.name}<span class="font-medium" translate="no">{t(pk.name)}</span>{/if}
							{#if pk.at}<FactsPlace place={pk.at} {lang} />{/if}
							<span class={muted}>{[pk.size ? enumLabel(lang, 'parkingSize', pk.size) : '', pk.fills ? enumLabel(lang, 'parkingFills', pk.fills) : '', formatPrices(lang, pk.price)].filter(Boolean).join(' · ')}</span>
							{#if pk.freeWith}<div>{label(lang, 'freeWith')}: {t(pk.freeWith)}</div>{/if}
							{#if pk.note}<div class={muted}>{t(pk.note)}</div>{/if}
							<div class={meta}>{#if pk.url}<a class="underline" href={pk.url.url} rel="noopener">{pk.url.label ? t(pk.url.label) : pk.url.url}</a>{' · '}{/if}{checked(pk.checked, a.checked)}</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if a?.borders?.length}
				<h3 class={h3}>{label(lang, 'borders')}</h3>
				<ul class="flex flex-col gap-1">
					{#each a.borders as bd}
						<li><FactsPlace place={bd.at} {lang} km />: <span translate="no">{bd.from} → {bd.to}</span>{#if bd.note}{' — '}{t(bd.note)}{/if}</li>
					{/each}
				</ul>
			{/if}

			{#if facts.stops?.length}
				<h3 class="{h3} flex items-center gap-2"><HomeOutline class="w-5 h-5 text-primary-600" />{label(lang, 'stops')}</h3>
				<ul class="flex flex-col gap-2">
					{#each facts.stops as st}
						<li>
							<FactsPlace place={st.at} {lang} km />
							{#if st.kind}<span class={muted}>({enumLabel(lang, 'stop', st.kind)})</span>{/if}
							<div class={muted}>
								{[
									st.open ? `${label(lang, 'open')}: ${st.open === 'all-year' ? label(lang, 'allYear') : st.open === 'closed' ? label(lang, 'closed') : formatWindow(lang, st.open)}` : '',
									st.days ? t(st.days) : '',
									st.overnight ? label(lang, 'overnight') : '',
									st.food ? label(lang, 'food') : '',
									st.water ? label(lang, 'water').toLowerCase() : '',
									st.cash ? label(lang, 'cashOnly') : '',
									formatPrices(lang, st.price)
								].filter(Boolean).join(' · ')}
							</div>
							{#if st.note}<div class={muted}>{t(st.note)}</div>{/if}
							<div class={meta}>
								{#if st.booking}<a class="underline" href={st.booking.url} rel="noopener">{st.booking.label ? t(st.booking.label) : label(lang, 'book')}</a>{' · '}{/if}{#if st.phone}<a class="underline" href="tel:{st.phone.replace(/\s/g, '')}" translate="no">{st.phone}</a>{' · '}{/if}{checked(st.checked)}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if facts.permits?.length}
				<h3 class={h3}>{label(lang, 'permits')}</h3>
				<ul class="flex flex-col gap-2">
					{#each facts.permits as pm}
						<li>
							<span class="font-medium">{t(pm.name)}</span>
							<span class={muted}>({pm.required === false ? label(lang, 'notRequired') : label(lang, 'required')}{#if pm.price?.length}, {formatPrices(lang, pm.price)}{/if})</span>
							{#if pm.where}<div>{t(pm.where)}</div>{/if}
							{#if pm.note}<div class={muted}>{t(pm.note)}</div>{/if}
							<div class={meta}>{#if pm.url}<a class="underline" href={pm.url.url} rel="noopener">{pm.url.label ? t(pm.url.label) : pm.url.url}</a>{' · '}{/if}{checked(pm.checked)}</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if facts.protectedAreas}
				<h3 class={h3}>{label(lang, 'protectedAreas')}</h3>
				<p>{t(facts.protectedAreas)}</p>
			{/if}

			{#if facts.drones}
				<h3 class={h3}>{label(lang, 'drones')}</h3>
				<p>{t(facts.drones)}</p>
			{/if}

			{#if facts.rules?.length}
				<h3 class={h3}>{label(lang, 'rules')}</h3>
				<ul class="flex flex-col gap-1">
					{#each facts.rules as ru}
						<li>
							<span class="font-medium">{enumLabel(lang, 'rule', ru.kind, ru.label)}</span>
							{#if ru.from || ru.to}<span class={muted}>(<FactsSpan {lang} from={ru.from} to={ru.to} />)</span>{/if}
							{#if ru.season?.length}<span class={meta}>{formatMonths(lang, ru.season)}</span>{/if}
							{#if ru.note}{' — '}{t(ru.note)}{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if hasPlan}
		<section aria-labelledby="facts-plan">
			<h2 id="facts-plan" class={h2}><ClipboardListOutline class="w-6 h-6 text-primary-600" />{label(lang, 'plan')}</h2>
			{#if p?.note}<p class="mb-2">{t(p.note)}</p>{/if}

			{#if p?.for?.length || p?.notFor?.length}
				<div class="grid sm:grid-cols-2 gap-4">
					{#if p.for?.length}
						<div>
							<h3 class="font-semibold mb-1 text-green-700 dark:text-green-400">{label(lang, 'forWho')}</h3>
							<ul class="list-disc ps-5">{#each p.for as x}<li>{t(x)}</li>{/each}</ul>
						</div>
					{/if}
					{#if p.notFor?.length}
						<div>
							<h3 class="font-semibold mb-1 text-red-700 dark:text-red-400">{label(lang, 'notFor')}</h3>
							<ul class="list-disc ps-5">{#each p.notFor as x}<li>{t(x)}</li>{/each}</ul>
						</div>
					{/if}
				</div>
			{/if}

			{#if s}
				<h3 class={h3}>{label(lang, 'suitability')}</h3>
				<dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
					{#if s.kids}<dt class={dt}>{label(lang, 'kids')}</dt><dd>{enumLabel(lang, 'kids', s.kids)}</dd>{/if}
					{#if s.dogs}<dt class={dt}>{label(lang, 'dogs')}</dt><dd>{enumLabel(lang, 'dogs', s.dogs)}</dd>{/if}
					{#if s.stroller != null}<dt class={dt}>{label(lang, 'stroller')}</dt><dd>{label(lang, s.stroller ? 'yes' : 'no')}</dd>{/if}
					{#if s.bike}<dt class={dt}>{label(lang, 'bike')}</dt><dd>{enumLabel(lang, 'bike', s.bike)}</dd>{/if}
					{#if s.winter}<dt class={dt}>{label(lang, 'winterSuit')}</dt><dd>{enumLabel(lang, 'winter', s.winter)}</dd>{/if}
					{#if s.night}<dt class={dt}>{label(lang, 'night')}</dt><dd>{enumLabel(lang, 'experienced', s.night)}</dd>{/if}
					{#if s.solo}<dt class={dt}>{label(lang, 'solo')}</dt><dd>{enumLabel(lang, 'experienced', s.solo)}</dd>{/if}
				</dl>
				{#if s.note}<p class="mt-1 {muted}">{t(s.note)}</p>{/if}
			{/if}

			{#if gearByNeed.length}
				<h3 class={h3}>{label(lang, 'gear')}</h3>
				<div class="grid sm:grid-cols-3 gap-4">
					{#each gearByNeed as group}
						<div>
							<h4 class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{enumLabel(lang, 'gearNeed', group.need)}</h4>
							<ul class="flex flex-col gap-1">
								{#each group.items as g}
									<li>
										<label class="flex items-start gap-2 cursor-pointer">
											<input type="checkbox" class="mt-1.5 rounded border-gray-300 text-primary-600" />
											<span>
												{enumLabel(lang, 'gear', g.item, g.label)}{#if g.amount}{' '}<span class={muted}>({t(g.amount)})</span>{/if}
												{#if g.when}<span class="block text-sm {muted}">{t(g.when)}</span>{/if}
											</span>
										</label>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}

			{#if p?.variants?.length}
				<h3 class={h3}>{label(lang, 'variants')}</h3>
				<ul class="flex flex-col gap-3">
					{#each p.variants as v}
						<li class="rounded-lg border p-3 {v.recommended ? 'border-primary-400 dark:border-primary-600' : 'border-gray-200 dark:border-gray-700'}">
							<div class="flex flex-wrap items-baseline gap-2">
								{#if v.link}<a class="font-medium underline" href={postHref(v.link)}>{t(v.name)}</a>{:else}<span class="font-medium">{t(v.name)}</span>{/if}
								{#if v.recommended}<span class="text-xs font-medium px-2 py-0.5 rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-300">{label(lang, 'recommended')}</span>{/if}
								<span class={meta} translate="no">
									{[v.distance != null ? getDistance(v.distance) : '', v.ascent != null ? `↑ ${v.ascent} m` : '', v.descent != null ? `↓ ${v.descent} m` : '', v.duration != null ? formatMinutes(lang, v.duration) : '', v.sac ?? '', v.viaFerrata ? formatFerrata(lang, v.viaFerrata) : ''].filter(Boolean).join(' · ')}
								</span>
							</div>
							{#if v.summary}<p class="mt-1">{t(v.summary)}</p>{/if}
							{#if v.note}<p class="mt-1 {muted}">{t(v.note)}</p>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if p?.timing}
				<h3 class={h3}>{label(lang, 'timing')}</h3>
				<ul class="flex flex-col gap-1">
					{#if p.timing.start}<li>{label(lang, 'startBy')} <span translate="no" class="font-medium">{p.timing.start}</span></li>{/if}
					{#if p.timing.turnaround}<li>{label(lang, 'turnaround')} <span translate="no" class="font-medium">{p.timing.turnaround}</span></li>{/if}
					{#if p.timing.sunrise}<li>{label(lang, 'sunrise')} <span translate="no" class="font-medium">{p.timing.sunrise.start}</span>{#if p.timing.sunrise.note}{' — '}{t(p.timing.sunrise.note)}{/if}</li>{/if}
				</ul>
				{#if p.timing.note}<p class="mt-1 {muted}">{t(p.timing.note)}</p>{/if}
			{/if}

			{#if p?.alternatives}
				<h3 class={h3}>{label(lang, 'alternatives')}</h3>
				<dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
					{#each [['easier', p.alternatives.easier], ['harder', p.alternatives.harder], ['similar', p.alternatives.similar]] as const as [key, slugs]}
						{#if slugs?.length}
							<dt class={dt}>{label(lang, key)}</dt>
							<dd>{#each slugs as slug, i}{i > 0 ? ', ' : ''}<a class="underline" href={postHref(slug)}>{postTitle(slug)}</a>{/each}</dd>
						{/if}
					{/each}
				</dl>
			{/if}
		</section>
	{/if}

	{#if facts.sources?.length}
		<section aria-labelledby="facts-sources">
			<h2 id="facts-sources" class={h2}><BookOpenOutline class="w-6 h-6 text-primary-600" />{label(lang, 'sources')}</h2>
			<ul class="flex flex-col gap-1">
				{#each facts.sources as src}
					<li>
						<a class="underline" href={src.url} rel="noopener" hreflang={src.lang}>{t(src.title)}</a>
						{#if src.kind || src.lang}<span class={meta}>({[src.kind ? enumLabel(lang, 'source', src.kind) : '', src.lang ?? ''].filter(Boolean).join(', ')})</span>{/if}
						{#if src.note}{' — '}{t(src.note)}{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

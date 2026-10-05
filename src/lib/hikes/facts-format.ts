/**
 * Formatting for the facts layer: labels, enum names, months, prices and
 * dates in the reader's language.
 *
 * Framework-free and browser-safe.
 */

import {
	textIn,
	type Bailout, type BailoutRoute, type ClimbGrade, type EnumGroup, type FerrataGrade, type Lang, type Price,
	type Season, type Text, type WaterSource, type Window
} from './facts-schema';
import { FACTS_STRINGS, type FactsLabel } from './facts-strings';

export function label(lang: Lang, key: FactsLabel): string {
	return FACTS_STRINGS[lang].labels[key];
}

/** An enum value's name; a free-text `label` wins, an unknown value shows as is. */
export function enumLabel(lang: Lang, group: EnumGroup, value: string | number, override?: Text): string {
	if (override) return textIn(override, lang);
	const names = FACTS_STRINGS[lang].enums[group as keyof (typeof FACTS_STRINGS)['en']['enums']] as Record<string, string> | undefined;
	return names?.[String(value)] ?? String(value);
}

export function monthName(lang: Lang, month: number): string {
	return FACTS_STRINGS[lang].months[month - 1] ?? String(month);
}

/** `[6, 7, 8, 10]` -> `Jun–Aug, Oct`; a run across the new year (`[11, 12, 1]`) stays one range. */
export function formatMonths(lang: Lang, months: number[] | undefined): string {
	const set = [...new Set(months ?? [])].sort((a, b) => a - b);
	if (set.length === 0) return '';
	if (set.length === 12) return label(lang, 'allYear');
	const runs: number[][] = [];
	for (const m of set) {
		const last = runs[runs.length - 1];
		if (last && last[last.length - 1] === m - 1) last.push(m);
		else runs.push([m]);
	}
	if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1].at(-1) === 12) {
		runs[runs.length - 1].push(...runs.shift()!);
	}
	return runs
		.map((r) => (r.length === 1 ? monthName(lang, r[0]) : `${monthName(lang, r[0])}–${monthName(lang, r[r.length - 1])}`))
		.join(', ');
}

function windowEnd(lang: Lang, end: string): string {
	const [m, d] = end.split('-').map(Number);
	return d ? (lang === 'de' ? `${d}. ${monthName(lang, m)}` : `${d} ${monthName(lang, m)}`) : monthName(lang, m);
}

/** `{ from: "06-15", to: "10-10" }` -> `15 Jun – 10 Oct`. */
export function formatWindow(lang: Lang, w: Window | undefined): string {
	return w ? `${windowEnd(lang, w.from)} – ${windowEnd(lang, w.to)}` : '';
}

/** `2026-07-19` -> `checked Jul 2026`. */
export function formatChecked(lang: Lang, date: string | undefined): string {
	if (!date) return '';
	const [y, m] = date.split('-').map(Number);
	return `${label(lang, 'checked')} ${monthName(lang, m)} ${y}`;
}

export function formatPrice(lang: Lang, p: Price): string {
	if (p.amount === 0) return label(lang, 'free');
	const amount = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
		style: 'currency',
		currency: p.currency ?? 'EUR',
		maximumFractionDigits: Number.isInteger(p.amount) ? 0 : 2
	}).format(p.amount);
	return [amount, p.per ? enumLabel(lang, 'pricePer', p.per) : '', p.note ? `(${textIn(p.note, lang)})` : '']
		.filter(Boolean)
		.join(' ');
}

export function formatPrices(lang: Lang, prices: Price[] | undefined): string {
	return (prices ?? []).map((p) => formatPrice(lang, p)).join(' · ');
}

/** Minutes as `1 h 30 min`. */
export function formatMinutes(lang: Lang, minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes - h * 60);
	const min = label(lang, 'min');
	return h === 0 ? `${m} ${min}` : m === 0 ? `${h} h` : `${h} h ${m} ${min}`;
}

export function formatKm(km: number): string {
	return `km ${km.toFixed(1)}`;
}

/** `B`, or `K3 (Hüsler)` when the scale isn't Schall. */
export function formatFerrata(lang: Lang, g: FerrataGrade): string {
	return !g.scale || g.scale === 'schall' ? g.grade : `${g.grade} (${enumLabel(lang, 'ferrataScale', g.scale)})`;
}

/** `II (UIAA)`. */
export function formatClimb(lang: Lang, g: ClimbGrade): string {
	return `${g.grade} (${enumLabel(lang, 'climbScale', g.scale ?? 'uiaa')})`;
}

/** A section's grades in one line: `T4 · B · II (UIAA)`. */
export function formatGrades(lang: Lang, g: { sac?: string; viaFerrata?: FerrataGrade; climbing?: ClimbGrade }): string {
	return [g.sac, g.viaFerrata ? formatFerrata(lang, g.viaFerrata) : '', g.climbing ? formatClimb(lang, g.climbing) : '']
		.filter(Boolean)
		.join(' · ');
}

/** The hardest of a route's via ferratas. Grades of one scale sort as text: A < A/B < B, K1 < K2, 1 < 2. */
export function hardestFerrata<T extends FerrataGrade>(ferratas: T[] | undefined): T | undefined {
	return (ferratas ?? []).reduce<T | undefined>((a, b) => (a == null || b.grade.localeCompare(a.grade) > 0 ? b : a), undefined);
}

/** The months to show for a season: the best ones, else the possible ones. */
export function seasonMonths(season: Season | undefined): number[] | undefined {
	return season?.best?.length ? season.best : season?.possible;
}

/** A bailout route's stats, one part each: `4.2 km`, `↑ 120 m`, `↓ 800 m`, `≈ 1 h 45 min` (to the quarter hour). */
export function formatRouteStats(lang: Lang, r: BailoutRoute): string[] {
	return [
		`${(r.distance / 1000).toFixed(1)} km`,
		r.ascent != null ? `↑ ${r.ascent} m` : '',
		r.descent != null ? `↓ ${r.descent} m` : '',
		r.duration != null ? `≈ ${formatMinutes(lang, Math.round(r.duration / 15) * 15)}` : ''
	].filter(Boolean);
}

/** Where a bailout leads, one part each: destination, means, time. */
export function formatBailoutWhere(lang: Lang, b: Bailout): string[] {
	return [b.to ? textIn(b.to, lang) : '', b.via ? enumLabel(lang, 'bailoutVia', b.via) : '', b.time ? formatMinutes(lang, b.time) : ''].filter(Boolean);
}

/** What a water source is, one part each: kind, reliability, whether to treat it. */
export function formatWater(lang: Lang, w: WaterSource): string[] {
	return [w.kind ? enumLabel(lang, 'water', w.kind) : '', w.reliable ? enumLabel(lang, 'reliability', w.reliable) : '', w.treat ? label(lang, 'treat') : ''].filter(Boolean);
}

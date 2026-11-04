import { enumLabel, monthName } from '$lib/hikes/facts-format';
import type { Lang } from '$lib/hikes/facts-schema';
import type { Spec } from '$lib/hikes/facts-spec';
import { namedLabel } from './place-value';

/** Top-level keys only a visit (the post) may set. */
export const POST_ONLY = ['conditions', 'deviations'];

/** The grades the validator takes as one value; a range (`T2-T3`) is typed in the post or the sidecar. */
export const SAC_GRADES = [1, 2, 3, 4, 5, 6].flatMap((n) => [`T${n}-`, `T${n}`, `T${n}+`]);

// Keys the camel-case split reads wrong.
const LABELS: Record<string, string> = {
	carFree: 'Car-free',
	sac: 'SAC grade',
	url: 'URL',
	temp: 'Temperature',
	lang: 'Language',
	inTable: 'In the leg table',
	onProfile: 'On the profile'
};

/**
 * The language a text shows beside English: the one remembered (`stored`) while the site still has it, else the first
 * other language; English alone (`en`) on a site with no other.
 */
export function factsLang<L extends string>(stored: string | null, others: readonly L[]): L | 'en' {
	return others.find((l) => l === stored) ?? others[0] ?? 'en';
}

/** A key in words: `viaFerrata` -> `Via ferrata`. */
export function fieldLabel(key: string): string {
	if (LABELS[key]) return LABELS[key];
	const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The choices of an enum (labelled from the site's table; raw without a group) or of an SAC grade. */
export function enumOptions(spec: Spec, lang: Lang = 'en'): { value: string | number; label: string }[] {
	if (spec.t === 'sac') return SAC_GRADES.map((g) => ({ value: g, label: g }));
	if (spec.t !== 'enum') return [];
	const group = spec.group;
	return spec.of.map((value) => ({ value, label: group ? enumLabel(lang, group, value) : String(value) }));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Anything but nothing: null, undefined, `''`, and lists and maps of nothing are empty. */
export function hasContent(v: unknown): boolean {
	if (v == null || v === '') return false;
	if (Array.isArray(v)) return v.some(hasContent);
	if (isObject(v)) return Object.values(v).some(hasContent);
	return true;
}

/** A text's English and its other languages, from a plain string or a `{en, <lang>…}` map. */
export function textParts(v: unknown): Record<string, string> {
	if (typeof v === 'string') return { en: v };
	return isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Record<string, string> : {};
}

export const ENGLISH_REQUIRED = 'English is required while there is a translation';

/**
 * A text edit (`{en, <lang>}`, an empty string clearing that language) on the current value, as the server writes it:
 * undefined when nothing is left, else the `{en, <lang>…}` map keeping every other language (English alone is `{en}`).
 * Clearing the English while a translation stays is refused, as the server would (and its 400 drops the whole batch).
 */
export function mergeText(cur: unknown, edit: Record<string, string>): { value: unknown } | { error: string } {
	const next = textParts(cur);
	for (const [lang, text] of Object.entries(edit)) {
		if (text.trim() === '') delete next[lang];
		else next[lang] = text;
	}
	const translated = Object.keys(next).some((k) => k !== 'en');
	if (next.en === undefined && translated) return { error: ENGLISH_REQUIRED };
	return { value: Object.keys(next).length ? next : undefined };
}

/**
 * A text field's edit: every language, `lang` as typed. The save queue coalesces sets on one path by keeping the last,
 * so each edit states them all: the local text's languages, and `''` for each other one of `stated` (the doc's value and
 * the values of the ops in flight and queued; see statedTexts). The server drops an empty language, so a language
 * cleared or switched within the debounce stays as it was typed.
 */
export function textEdit(stated: unknown[], local: unknown, lang: string, typed: string): Record<string, string> {
	const cleared = Object.fromEntries(stated.flatMap((t) => Object.keys(textParts(t))).map((k) => [k, '']));
	return { ...cleared, ...textParts(local), [lang]: typed };
}

/**
 * A value built in the form, its texts written as the server would keep them: empty languages dropped, English alone a
 * `{en}` map, an empty text gone. For an op whose value holds texts (a whole entry); a text field's own edit is sent as typed.
 */
export function normaliseTexts(spec: Spec | undefined, value: unknown): unknown {
	if (value == null || !spec) return value;
	switch (spec.t) {
		case 'text': {
			const r = mergeText(undefined, textParts(value));
			return 'value' in r ? r.value : value;
		}
		case 'list':
			return Array.isArray(value) ? value.map((v) => normaliseTexts(spec.of, v)).filter((v) => v !== undefined) : value;
		case 'obj': {
			if (!isObject(value)) return value;
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value)) {
				const n = normaliseTexts(spec.f[k], v);
				if (n !== undefined) out[k] = n;
			}
			return out;
		}
		default:
			return value;
	}
}

/** A link as written: the URL alone while it has no label, else `{url, label}`; undefined when both are empty. */
export function linkValue(url: string, label: unknown): unknown {
	if (label === undefined) return url === '' ? undefined : url;
	return { url, label };
}

/**
 * A value in words, for reading where it isn't edited (an inherited hike value): English and the session language of a
 * text; `names` names a place's OSM ref (the store's names).
 */
export function valueText(spec: Spec | undefined, v: unknown, lang: Lang, names?: (ref: string) => string | undefined): string {
	if (v == null || !spec) return '';
	switch (spec.t) {
		case 'text': {
			const parts = textParts(v);
			return [parts.en, lang === 'en' ? undefined : parts[lang]].filter((t) => t).join(' / ');
		}
		case 'enum':
		case 'sac':
			return enumOptions(spec).find((o) => String(o.value) === String(v))?.label ?? String(v);
		case 'bool':
			return v === true ? 'Yes' : v === false ? 'No' : String(v);
		case 'month':
			return typeof v === 'number' ? monthName('en', v) : String(v);
		case 'place':
		case 'spot':
		case 'gpx':
			return namedLabel(v, names);
		case 'link': {
			if (!isObject(v)) return String(v);
			const label = valueText({ t: 'text' }, v.label, lang);
			return label ? `${label} (${String(v.url ?? '')})` : String(v.url ?? '');
		}
		case 'window':
			return isObject(v) ? `${String(v.from ?? '')} – ${String(v.to ?? '')}` : String(v);
		case 'open':
			return v === 'all-year' ? 'All year' : v === 'closed' ? 'Closed' : valueText({ t: 'window' }, v, lang);
		case 'list':
			return Array.isArray(v) ? v.map((x) => valueText(spec.of, x, lang, names)).filter((t) => t).join(spec.of.t === 'obj' ? ' | ' : ', ') : String(v);
		case 'obj':
			if (!isObject(v)) return String(v);
			return Object.entries(v)
				.map(([k, x]) => [fieldLabel(k), valueText(spec.f[k], x, lang, names)])
				.filter(([, t]) => t)
				.map(([k, t]) => `${k}: ${t}`)
				.join('; ');
		default:
			return typeof v === 'object' ? JSON.stringify(v) : String(v);
	}
}

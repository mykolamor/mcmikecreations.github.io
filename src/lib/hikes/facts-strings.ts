/**
 * Labels for the facts layer, per language: field labels, and a name for every
 * enum value in `facts-schema.ts` (a test fails when one is missing). The
 * strings live under `facts` in the string tables (`i18n/en.json`, `de.json`,
 * read through `strings.ts`); this is their view for `facts-format.ts`, a key another language lacks
 * reading as the English.
 *
 * Framework-free and browser-safe.
 */

import type { Lang } from './facts-schema';
import { TABLES } from '../i18n/strings';

type Strings = typeof TABLES.en.facts;
type Node = string | string[] | { [key: string]: Node };

/** `base` with every key `over` has replaced by its value. */
function withFallback<T extends Node>(base: T, over: Node | undefined): T {
	if (typeof base === 'string' || Array.isArray(base)) return (typeof over === typeof base ? over : base) as T;
	const table = (over && typeof over === 'object' && !Array.isArray(over) ? over : {}) as Record<string, Node>;
	return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, withFallback(value, table[key])])) as T;
}

/** The facts view of `tables`, one entry per table: English as it is, any other language over the English. */
export function factsStrings<L extends string>(tables: { en: { facts: Strings } } & Record<L, { facts?: Node }>): Record<L | 'en', Strings> {
	return Object.fromEntries(Object.entries<{ facts?: Node }>(tables).map(([lang, table]) =>
		[lang, lang === 'en' ? tables.en.facts : withFallback(tables.en.facts, table.facts)])) as Record<L | 'en', Strings>;
}

export const FACTS_STRINGS: Record<Lang, Strings> = factsStrings(TABLES);
export type FactsLabel = keyof Strings['labels'];

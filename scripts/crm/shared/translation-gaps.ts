// What a doc still lacks per language, as the Open screen's badges and the tab dots show it. Found by
// server/translation-gaps.ts; browser-safe.

/** The three parts of a translation pass: the Facts tab's texts, the Write tab's body, the Details tab's words. */
export const GAP_PARTS = ['facts', 'text', 'details'] as const;
export type GapPart = (typeof GAP_PARTS)[number];

/** By language, the parts with something missing, in GAP_PARTS order; a language with nothing missing has no key. */
export type Gaps = Record<string, GapPart[]>;

const LABELS: Record<GapPart, string> = { facts: 'Facts', text: 'Text', details: 'Details' };
const TABS: Record<GapPart, string> = { facts: 'facts', text: 'write', details: 'details' };

/** One line per language with something missing: `DE: Facts, Text`. */
export const gapBadges = (gaps: Gaps): string[] =>
	Object.entries(gaps).map(([lang, parts]) => `${lang.toUpperCase()}: ${parts.map((p) => LABELS[p]).join(', ')}`);

/** Whether the tab `tabId` has something missing in `lang`. */
export const tabHasGap = (gaps: Gaps, lang: string | null, tabId: string): boolean =>
	!!lang && !!gaps[lang]?.some((p) => TABS[p] === tabId);

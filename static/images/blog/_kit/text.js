// Localized text and number formatting for figures and slides. DOM-free.
/** @typedef {{ en: string, de: string, uk: string }} Localized */
/** @typedef {Localized | string | ((lang: string) => string)} Text Localized text, a fixed string, or a formatter. */

/**
 * The text for `lang`: formatters are called with it, strings pass through, Localized falls back to English.
 * @param {Text} value @param {string} lang @returns {string}
 */
export function pick(value, lang) {
	if (typeof value === 'function') return value(lang);
	if (typeof value === 'string') return value;
	return /** @type {Record<string, string>} */ (value)[lang] ?? value.en;
}

/**
 * A number formatted per language with Intl.NumberFormat (de/uk: decimal comma).
 * @param {number} v @param {Intl.NumberFormatOptions} [opts] @param {string} [suffix]
 * @returns {(lang: string) => string}
 */
export const fmt = (v, opts = {}, suffix = '') => (lang) => new Intl.NumberFormat(lang, opts).format(v) + suffix;

/** A number with a fixed number of decimals (default: up to 3). @param {number} v @param {number} [digits] @param {string} [suffix] */
export const num = (v, digits, suffix = '') =>
	fmt(v, digits == null ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }, suffix);

/** A factor like the paper's plots: 1.8×, 12×, 0.50×. @param {number} v */
export const times = (v) => num(v >= 10 ? Math.round(v) : v, v >= 10 ? 0 : v >= 1 ? 1 : 2, '×');

/** A proper name (system, GPU, query) that stays the same in every language. @param {string} s @returns {Localized} */
export const same = (s) => ({ en: s, de: s, uk: s });

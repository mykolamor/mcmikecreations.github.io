// Colour tokens for figures. Figures only use var(--fig-<token>); an embed sets the tokens from a palette
// (defaults below, light and dark), a slide maps them to the deck frame's --fig-* variables. DOM-free.

/** The tokens every figure can rely on. */
export const TOKENS = ['fg', 'bg', 'muted', 'accent', 'accent2', 'dim'];

/** Defaults: the site's gray/teal/amber, as src/lib/presentation/Presentation.svelte defines them for decks (--pres-*). */
export const DEFAULT_PALETTE = {
	fg: { light: 'var(--color-gray-900, #111827)', dark: 'var(--color-gray-100, #f3f4f6)' },
	bg: { light: 'var(--color-white, #fff)', dark: 'var(--color-gray-900, #111827)' },
	muted: { light: 'var(--color-gray-500, #6b7280)', dark: 'var(--color-gray-400, #9ca3af)' },
	accent: { light: 'var(--color-primary-600, #0d9488)', dark: 'var(--color-primary-400, #2dd4bf)' },
	accent2: { light: 'var(--color-amber-500, #f59e0b)', dark: 'var(--color-amber-400, #fbbf24)' },
	dim: { light: 'var(--color-gray-300, #d1d5db)', dark: 'var(--color-gray-700, #374151)' }
};

/** @typedef {Record<string, string | { light: string, dark: string }>} Palette One value for both themes, or one per theme. */

/**
 * CSS custom properties (`--fig-<name>`) for `theme`: the defaults, overridden and extended by `palette`.
 * @param {Palette | undefined} palette @param {'light' | 'dark'} theme @returns {Record<string, string>}
 */
export function paletteVars(palette, theme) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [name, v] of Object.entries({ ...DEFAULT_PALETTE, ...palette })) out[`--fig-${name}`] = typeof v === 'string' ? v : v[theme];
	return out;
}

/** In a deck the tokens follow the frame's colours (and with them its theme switches). */
export const PRES_VARS = Object.fromEntries(TOKENS.map((t) => [`--fig-${t}`, `var(--pres-${t})`]));

/** `c` mixed into the figure background, so tints work in both themes. @param {string} c @param {number} p percent of `c` */
export const tint = (c, p) => `color-mix(in oklab, ${c} ${p}%, var(--fig-bg))`;

/** Diagonal stripes of `c` (a second series in the same hue). @param {string} c */
export const stripes = (c) => `repeating-linear-gradient(135deg, ${c} 0 5px, color-mix(in srgb, ${c} 35%, transparent) 5px 9px)`;

// This post's chart and diagram colours, derived from the figure tokens (--fig-*), so they follow the theme.
import { stripes } from '../_kit/palette.js';

/** Bar fills per system, theme-aware through the figure colour tokens. */
export const FILL = {
	lingoGpu: 'var(--fig-accent)',
	lingoCpu: stripes('var(--fig-accent)'),
	crystal: 'var(--fig-accent2)',
	themis: stripes('var(--fig-accent2)'),
	// Full systems get their own hues (mixed from the theme, so they follow dark mode); teal stays LingoDB's
	// and amber the prototypes'. GQE stripes Sirius's hue: both are built on cuDF.
	heavydb: 'color-mix(in oklab, var(--fig-accent2) 55%, var(--fig-fg))',
	sirius: 'color-mix(in oklab, var(--fig-muted) 40%, var(--fig-accent))',
	gqe: stripes('color-mix(in oklab, var(--fig-muted) 40%, var(--fig-accent))'),
	pystachio: 'color-mix(in oklab, var(--fig-accent) 45%, var(--fig-accent2))',
	tile: 'var(--fig-accent2)',
	op: 'var(--fig-muted)'
};

// ---------------------------------------------------------------------------------------------
// Diagram palette: the TikZ figures' blue/amber/green/purple/gray mapped onto the colour tokens.
// Tints (kit `tint`) mix with the background, so they work in both themes; text on them stays var(--fig-fg).
// ---------------------------------------------------------------------------------------------

export const PAL = {
	blue: 'var(--fig-accent)',
	amber: 'var(--fig-accent2)',
	green: 'color-mix(in oklab, var(--fig-accent) 45%, var(--fig-accent2))',
	purple: 'color-mix(in oklab, var(--fig-muted) 55%, var(--fig-accent))',
	gray: 'var(--fig-muted)',
	red: 'color-mix(in oklab, var(--fig-accent2) 55%, var(--fig-fg))'
};

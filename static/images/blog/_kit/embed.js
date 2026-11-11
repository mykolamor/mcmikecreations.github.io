// Static runner: shows a kit figure in a post as a script embed (see src/lib/renderers/ScriptEmbed.svelte).
// The figure is drawn once at its own size, painted for the page language, set to one state, and scaled
// down to the post column. Colours come from a palette (kit defaults, per-post overrides) and follow the
// site's dark mode (the `dark` class on <html>).
import { createRecord, builder, paint, apply } from './kit.js';
import { paletteVars } from './palette.js';

/** @typedef {import('./kit.js').Kit} Kit */
/** @typedef {import('./palette.js').Palette} Palette */
/** @typedef {{ size: { w: number, h: number }, draw: (k: Kit, root: HTMLElement) => void }} Figure */

/**
 * Scale that fits a figure of `figureWidth` into `containerWidth`: never enlarges, 0 while there is no width.
 * @param {number} containerWidth @param {number} figureWidth @returns {number}
 */
export function fitScale(containerWidth, figureWidth) {
	const s = containerWidth / figureWidth;
	return Number.isFinite(s) && s > 0 ? Math.min(1, s) : 0;
}

/**
 * Where a `w`×`h` figure sits in a column `containerWidth` wide: its scale, its left offset (centred when the
 * figure is narrower than the column) and the height it takes.
 * @param {number} containerWidth @param {number} w @param {number} h @returns {{ scale: number, left: number, height: number }}
 */
export function fitBox(containerWidth, w, h) {
	const scale = fitScale(containerWidth, w);
	return { scale, left: scale ? Math.max(0, (containerWidth - w * scale) / 2) : 0, height: h * scale };
}

/**
 * A script-embed mount function for `fig`: `export default embedFigure(fig, { palette })`.
 * @param {Figure} fig @param {{ state?: number, palette?: Palette }} [opts]
 * @returns {(container: HTMLElement, o?: { caption?: string }) => () => void}
 */
export function embedFigure(fig, opts = {}) {
	const { w, h } = fig.size;
	return function mount(container, { caption = '' } = {}) {
		const html = document.documentElement;
		const wrap = document.createElement('div');
		wrap.style.cssText = 'position:relative;width:100%;overflow:hidden;';
		wrap.setAttribute('role', 'img');
		if (caption) wrap.setAttribute('aria-label', caption);
		const stage = document.createElement('div');
		stage.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;font-size:32px;line-height:1.3;color:var(--fig-fg);`;
		wrap.append(stage);

		const colours = () => {
			for (const [k, v] of Object.entries(paletteVars(opts.palette, html.classList.contains('dark') ? 'dark' : 'light'))) wrap.style.setProperty(k, v);
		};
		colours();

		const rec = createRecord();
		fig.draw(builder(rec), stage);
		paint(rec, html.lang || 'en');
		apply(rec, opts.state ?? 0);
		container.append(wrap);

		const fit = () => {
			const box = fitBox(container.clientWidth, w, h);
			stage.style.left = `${box.left}px`;
			stage.style.transform = `scale(${box.scale})`;
			wrap.style.height = `${box.height}px`;
		};
		fit();
		const resize = new ResizeObserver(fit);
		resize.observe(container);
		const theme = new MutationObserver(colours);
		theme.observe(html, { attributes: true, attributeFilter: ['class'] });

		return () => {
			resize.disconnect();
			theme.disconnect();
			rec.tl?.cancel();
		};
	};
}

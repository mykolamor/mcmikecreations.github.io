// The figure kit's core: a figure (or slide) builds its DOM through a builder that records localized texts
// and "parts" (an element plus a function mapping a state to its props). paint() fills the texts for a
// language; apply() sets every part to one state. Static embeds paint and apply once; slides animate between
// states on top of the same record (see slide.js).
import { utils } from 'animejs';
import { h, svg, rich } from './dom.js';
import { pick } from './text.js';

/** @typedef {import('./text.js').Localized} Localized */
/** @typedef {import('./text.js').Text} Text */
/** @typedef {import('animejs').Timeline} Timeline */
/** @typedef {Record<string, number>} Props */
/**
 * @typedef {{ el: HTMLElement, at: (s: number) => Props, delay?: (from: number, to: number) => number | undefined,
 *   duration?: number, ease?: string }} Part
 * @typedef {{ parts: Part[], texts: [Element, Text, boolean][], attrs: [HTMLElement, string, Localized][], tl: Timeline | null, state: number, title: HTMLElement | null }} FigRecord
 */

/** A fresh, empty record; one per mount. @returns {FigRecord} */
export function createRecord() {
	return { parts: [], texts: [], attrs: [], tl: null, state: 0, title: null };
}

/** Visible while `from <= s < until`, sliding in by `dy`/`dx`. */
export const showAt = (from, until = Infinity, dy = 24, dx = 0) => (/** @type {number} */ s) => {
	const on = s >= from && s < until;
	return { opacity: on ? 1 : 0, translateY: on ? 0 : dy, translateX: on ? 0 : dx };
};

/**
 * Builder handed to a figure's draw() or a slide's build(): creates elements, registers texts and parts.
 * @param {FigRecord} m
 */
export function builder(m) {
	return {
		h,
		/** Element whose (rich) text is loc in the current language, re-applied on language change. @param {string} tag @param {string} css @param {Text} loc */
		text(tag, css, loc) {
			const el = h(tag, css);
			m.texts.push([el, loc, false]);
			return el;
		},
		/** SVG <text> (plain text, no markup; `\n` starts a new line) whose content is loc in the current language. @param {Record<string, string | number>} attrs @param {Text} loc */
		svgText(attrs, loc) {
			const el = svg('text', attrs);
			m.texts.push([el, loc, true]);
			return el;
		},
		/** Localized attribute (alt, aria-label), re-applied on language change. @param {HTMLElement} el @param {string} name @param {Localized} loc */
		attr(el, name, loc) {
			m.attrs.push([el, name, loc]);
			return el;
		},
		/** Registers an animated part. @param {HTMLElement} el @param {(s: number) => Props} at @param {Partial<Part>} [opts] */
		part(el, at, opts = {}) {
			m.parts.push({ el, at, ...opts });
			return el;
		},
		/** Shorthand: part visible while from <= s < until. @param {HTMLElement} el @param {number} from @param {number} [until] @param {Partial<Part>} [opts] */
		show(el, from, until = Infinity, opts = {}) {
			m.parts.push({ el, at: showAt(from, until), ...opts });
			return el;
		}
	};
}
/** @typedef {ReturnType<typeof builder>} Kit */

/** Fills every registered text and attribute for `lang`. @param {FigRecord} m @param {string} lang */
export function paint(m, lang) {
	for (const [el, loc, plain] of m.texts) {
		const t = pick(loc, lang);
		if (plain && t.includes('\n')) {
			// SVG <text> ignores newlines: one <tspan> per line, each back at the text's x, one line lower.
			const x = el.getAttribute('x');
			el.replaceChildren(...t.split('\n').map((line, i) => svg('tspan', { x, dy: i ? '1.2em' : null }, line)));
		} else if (plain) el.textContent = t;
		else el.innerHTML = rich(t);
	}
	for (const [el, name, loc] of m.attrs) el.setAttribute(name, pick(loc, lang));
}

/** Sets every part to `state` instantly. @param {FigRecord} m @param {number} state */
export function apply(m, state) {
	m.tl?.cancel();
	m.tl = null;
	m.state = state;
	for (const p of m.parts) utils.set(p.el, p.at(state));
}

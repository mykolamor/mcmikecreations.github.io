// DOM helpers for figures and slides: elements, SVG, arrows, markdown-lite text, SVG canvases.
/**
 * Creates an element. Children may be elements or strings (text nodes).
 * @param {string} tag @param {string} [css] @param {...(Node | string)} children
 */
export function h(tag, css = '', ...children) {
	const el = document.createElement(tag);
	if (css) el.style.cssText = css;
	el.append(...children);
	return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Creates an SVG element. Attribute values that are null/undefined are skipped.
 * @param {string} tag @param {Record<string, string | number | null | undefined>} [attrs] @param {...(Node | string)} children
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}, ...children) {
	const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
	for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
	el.append(...children);
	return el;
}

/**
 * Arrow with a filled triangular head at `to`; `via` are optional cubic control points (c1, c2).
 * @param {[number, number]} from @param {[number, number]} to
 * @param {{ c1?: [number, number], c2?: [number, number], color?: string, width?: number, dash?: string, head?: number }} [o]
 */
export function arrow(from, to, o = {}) {
	const color = o.color ?? 'var(--fig-fg)';
	const w = o.width ?? 3;
	const head = o.head ?? 5 + w * 2.2;
	const back = o.c2 ?? o.c1 ?? from;
	const ang = Math.atan2(to[1] - back[1], to[0] - back[0]);
	const end = [to[0] - Math.cos(ang) * head * 0.8, to[1] - Math.sin(ang) * head * 0.8];
	const d = o.c1 ? `M${from} C${o.c1} ${o.c2 ?? o.c1} ${end}` : `M${from} L${end}`;
	const g = svg('g');
	g.append(
		svg('path', { d, fill: 'none', style: `stroke:${color};stroke-width:${w};${o.dash ? `stroke-dasharray:${o.dash};` : ''}` }),
		svg('path', {
			d: `M${to} L${to[0] - Math.cos(ang - 0.42) * head},${to[1] - Math.sin(ang - 0.42) * head} L${to[0] - Math.cos(ang + 0.42) * head},${to[1] - Math.sin(ang + 0.42) * head}Z`,
			style: `fill:${color};`
		})
	);
	return g;
}

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Markdown-lite to HTML: `code`, **strong** and *em*. Input is our own slide text.
 * @param {string} s
 */
export function rich(s) {
	return s.split(/(`[^`]*`)/).map((seg) => {
		if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 1) {
			return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.88em;">${esc(seg.slice(1, -1))}</code>`;
		}
		return esc(seg)
			.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--fig-accent);font-weight:700;">$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	}).join('');
}

/** An SVG canvas placed at `css` (absolute, slide px) with a viewBox of the same size. @param {number} w @param {number} h @param {string} css */
export function canvas(w, h, css) {
	return svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, style: `position:absolute;overflow:visible;font-family:inherit;${css}` });
}

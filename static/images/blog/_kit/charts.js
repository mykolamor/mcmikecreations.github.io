// HTML bar charts and tables for figures and slides. Bars grow with scaleY, so anime.js can tween them.
import * as d3 from 'd3';
import { h } from './dom.js';
import { times } from './text.js';

/** @typedef {import('./text.js').Localized} Localized */
/** @typedef {import('./text.js').Text} Text */
/** @typedef {import('./kit.js').Kit} Builder */

/** Simple HTML table. Cells are Localized; header row first. @param {Builder} b @param {Localized[][]} rows @param {{ size?: number, widths?: string[], at?: (r: number) => number }} [o] */
export function table(b, rows, o = {}) {
	const size = o.size ?? 26;
	const t = h('table', `border-collapse:collapse;width:100%;font-size:${size}px;line-height:1.25;`);
	rows.forEach((row, r) => {
		const tr = h('tr', r === 0 ? 'border-bottom:3px solid var(--fig-fg);' : 'border-bottom:1px solid var(--fig-dim);');
		row.forEach((cell, c) => {
			const td = b.text(r === 0 ? 'th' : 'td', `text-align:left;vertical-align:top;padding:10px 14px;${r === 0 ? 'font-weight:700;' : ''}${o.widths?.[c] ? `width:${o.widths[c]};` : ''}`, cell);
			tr.append(td);
		});
		if (o.at) b.show(tr, o.at(r));
		t.append(tr);
	});
	return t;
}

/**
 * @typedef {{ label: Localized, fill: string, value: (s: number, g: number) => number | null,
 *   inner?: (g: number) => number | null, mark?: (g: number) => boolean }} Series
 * @typedef {{ box: { x: number, y: number, w: number, h: number }, groups: string[], series: Series[],
 *   scale: 'log' | 'linear', domain: [number, number], base: number, ticks: number[], tickFmt: (v: number) => Text,
 *   axisLabel?: Localized, visible: (s: number) => boolean, dimGroup?: (s: number, g: number) => boolean,
 *   labels?: (s: number, g: number, i: number) => number | null, labelFmt?: (v: number) => Text, legend?: { x: number, y: number }, groupSize?: number, axisPad?: number,
 *   missing?: string, labelSize?: number }} ChartOpts
 */

/**
 * Builds a grouped bar chart into `root`. Bars above `base` grow upwards, below it downwards.
 * Values may differ per state (metric switches); `null` hides a bar (or marks it missing).
 * @param {Builder} b @param {HTMLElement} root @param {ChartOpts} o
 */
export function barChart(b, root, o) {
	const { x: X, y: Y, w: Wd, h: Ht } = o.box;
	const y = (o.scale === 'log' ? d3.scaleLog() : d3.scaleLinear()).domain(o.domain).range([Ht, 0]).clamp(true);
	const x = d3.scaleBand().domain(d3.range(o.groups.length).map(String)).range([0, Wd]).paddingInner(0.22).paddingOuter(0.08);
	const inner = d3.scaleBand().domain(d3.range(o.series.length).map(String)).range([0, x.bandwidth()]).padding(0.08);
	const y0 = y(o.base);
	const wrap = h('div', `position:absolute;left:${X}px;top:${Y}px;width:${Wd}px;height:${Ht}px;`);
	const vis = (/** @type {number} */ s) => ({ opacity: o.visible(s) ? 1 : 0 });
	b.part(wrap, vis, { duration: 450 });

	// Grid and ticks.
	for (const t of o.ticks) {
		const ty = y(t);
		wrap.append(h('div', `position:absolute;left:0;right:0;top:${ty}px;height:0;border-top:${t === o.base ? '2px solid var(--fig-muted)' : '1px dashed var(--fig-dim)'};`));
		wrap.append(b.text('div', `position:absolute;right:${Wd + 12}px;top:${ty - 13}px;font-size:20px;line-height:26px;color:var(--fig-muted);white-space:nowrap;`, o.tickFmt(t)));
	}
	if (o.axisLabel) {
		wrap.append(b.text('div', `position:absolute;left:-${o.axisPad ?? 100}px;top:${Ht / 2}px;transform:translate(-50%,-50%) rotate(-90deg);white-space:nowrap;font-size:20px;color:var(--fig-muted);`, o.axisLabel));
	}
	// Bars.
	o.groups.forEach((g, gi) => {
		const gx = x(String(gi)) ?? 0;
		const glabel = h('div', `position:absolute;left:${gx}px;width:${x.bandwidth()}px;top:${Ht + 8}px;text-align:center;font-size:${o.groupSize ?? 22}px;color:var(--fig-fg);`, g);
		wrap.append(glabel);
		if (o.dimGroup) b.part(glabel, (s) => ({ opacity: o.dimGroup?.(s, gi) ? 0.3 : 1 }));
		o.series.forEach((se, si) => {
			const bx = gx + (inner(String(si)) ?? 0);
			const bw = inner.bandwidth();
			const up = h('div', `position:absolute;left:${bx}px;width:${bw}px;top:0;height:${y0}px;transform-origin:50% 100%;background:${se.fill};border-radius:3px 3px 0 0;`);
			const down = h('div', `position:absolute;left:${bx}px;width:${bw}px;top:${y0}px;height:${Ht - y0}px;transform-origin:50% 0;background:${se.fill};border-radius:0 0 3px 3px;`);
			wrap.append(up, down);
			const dim = (/** @type {number} */ s) => (o.dimGroup?.(s, gi) ? 0.25 : 1);
			const ratio = (/** @type {number} */ s, /** @type {boolean} */ isUp) => {
				const v = se.value(s, gi);
				if (v == null || !o.visible(s)) return 0;
				if (isUp !== v >= o.base) return 0;
				const d = Math.abs(y(v) - y0);
				return d / (isUp ? y0 : Ht - y0 || 1);
			};
			b.part(up, (s) => ({ scaleY: ratio(s, true), opacity: dim(s) }));
			b.part(down, (s) => ({ scaleY: ratio(s, false), opacity: dim(s) }));
			if (se.inner) {
				// Darker lower section (e.g. kernel time inside total time).
				const iv = se.inner(gi);
				if (iv != null) {
					const ih = y0 - y(iv);
					const kin = h('div', `position:absolute;left:${bx}px;width:${bw}px;top:${y0 - ih}px;height:${ih}px;transform-origin:50% 100%;background:color-mix(in srgb, var(--fig-fg) 35%, transparent);`);
					wrap.append(kin);
					b.part(kin, (s) => ({ scaleY: se.value(s, gi) == null || !o.visible(s) ? 0 : 1, opacity: dim(s) }));
				}
			}
			if (se.mark?.(gi)) {
				const v = se.value(Infinity, gi) ?? o.base;
				const mk = h('div', `position:absolute;left:${bx + bw / 2}px;top:${(v >= o.base ? y(v) - 20 : y(v) + 4)}px;width:12px;height:12px;margin-left:-6px;border-radius:50%;border:3px solid ${se.fill.startsWith('var') ? se.fill : 'var(--fig-muted)'};box-sizing:border-box;`);
				wrap.append(mk);
				b.part(mk, (s) => ({ opacity: se.value(s, gi) != null && o.visible(s) ? dim(s) : 0 }));
			}
			if (o.missing && se.value(Infinity, gi) == null) {
				const mk = h('div', `position:absolute;left:${bx + bw / 2}px;top:${y0 - 26}px;transform:translateX(-50%);font-size:18px;color:var(--fig-muted);`, o.missing);
				wrap.append(mk);
				b.part(mk, (s) => ({ opacity: o.visible(s) ? dim(s) : 0 }));
			}
			if (o.labels) {
				// One label element per distinct text, cross-faded by state.
				/** @type {Map<number, { loc: Text, ss: number[] }>} */
				const seen = new Map();
				for (let s = 0; s < 32; s++) {
					const t = o.labels(s, gi, si);
					if (t == null) continue;
					if (!seen.has(t)) seen.set(t, { loc: (o.labelFmt ?? times)(t), ss: [] });
					seen.get(t)?.ss.push(s);
				}
				for (const { loc, ss } of seen.values()) {
					const v = se.value(ss[0], gi) ?? o.base;
					const ls = o.labelSize ?? 19;
					const top = v >= o.base ? y(v) - ls - 8 : y(v) + 4;
					const lab = b.text('div', `position:absolute;left:${bx + bw / 2}px;top:${top}px;transform:translateX(-50%);font-size:${ls}px;font-weight:600;white-space:nowrap;color:var(--fig-fg);`, loc);
					wrap.append(lab);
					b.part(lab, (s) => ({ opacity: ss.includes(s) && o.visible(s) ? 1 : 0 }));
				}
			}
		});
	});
	root.append(wrap);
	if (o.legend) {
		const lg = h('div', `position:absolute;left:${o.legend.x}px;top:${o.legend.y}px;display:flex;gap:26px;flex-wrap:wrap;font-size:22px;align-items:center;`);
		for (const se of o.series) {
			const it = h('span', 'display:inline-flex;align-items:center;gap:10px;');
			it.append(h('span', `width:22px;height:22px;border-radius:4px;background:${se.fill};`), b.text('span', '', se.label));
			lg.append(it);
		}
		b.part(lg, vis, { duration: 450 });
		root.append(lg);
	}
	return wrap;
}

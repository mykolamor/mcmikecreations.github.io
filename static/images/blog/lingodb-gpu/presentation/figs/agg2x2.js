// Plot: aggregation micro-benchmark, runtime vs. number of groups (paper's aggregation_2x2), drawn with d3
// from FIGDATA.aggregation2x2 (figures/aggregation/plotted-data.csv). As in plot_aggregation_2x2.py: rows =
// unfiltered/filtered, columns = runs/random, log2 x (groups), log10 y (median ms), colour = engine,
// dash + marker = workload, shared limits padded by 1.25×.
import * as d3 from 'd3';
import { svg, canvas, fmt } from '../lib.js';
import { FIGDATA } from '../data.js';

const S = FIGDATA.aggregation2x2.series;
const ENGINES = [
	{ key: 'lingodb', label: { en: 'LingoDB/GPU', de: 'LingoDB/GPU', uk: 'LingoDB/GPU' }, color: 'var(--fig-accent)' },
	{ key: 'sirius', label: { en: 'Sirius', de: 'Sirius', uk: 'Sirius' }, color: 'var(--fig-accent2)' }
];
const WORKLOADS = [
	{ key: 'decimal', dash: '', marker: 'circle', label: { en: 'Integer key + decimal aggregates', de: 'Int-Schlüssel + Dezimal-Aggregate', uk: 'Цілий ключ + десяткові агрегати' } },
	{ key: 'integer_min_string', dash: '9 5', marker: 'square', label: { en: 'Integer key + MIN(string)', de: 'Int-Schlüssel + MIN(String)', uk: 'Цілий ключ + MIN(рядок)' } },
	{ key: 'materialized_string', dash: '2 4', marker: 'triangle', label: { en: 'String key + MIN(string)', de: 'String-Schlüssel + MIN(String)', uk: 'Рядковий ключ + MIN(рядок)' } }
];
const ROWS = [
	{ key: 'unfiltered', label: { en: 'Unfiltered', de: 'Ungefiltert', uk: 'Без фільтра' } },
	{ key: 'filtered', label: { en: 'Filtered', de: 'Gefiltert', uk: 'З фільтром' } }
];
const COLS = [
	{ key: 'runs', label: { en: 'Runs', de: 'Läufe', uk: 'Серії' } },
	{ key: 'random', label: { en: 'Random', de: 'Zufällig', uk: 'Випадково' } }
];
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow2 = (/** @type {number} */ e) => `2${String(e).split('').map((d) => SUP[Number(d)]).join('')}`;

/**
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number, row: number) => boolean} rowVisible whether a row's lines are shown in state s
 */
export function agg2x2(b, root, x, y, rowVisible) {
	const W = 720;
	const H = 700;
	const c = canvas(W, H, `left:${x}px;top:${y}px;`);
	const all = Object.values(S).flat().map((p) => p[1]);
	const ys = d3.scaleLog().domain([(d3.min(all) ?? 1) / 1.25, (d3.max(all) ?? 100) * 1.25]);
	const xs = d3.scaleLinear().domain([-0.6, 26.6]);
	const left = 92;
	const top = 150;
	const gap = 18;
	const pw = (W - left - 34 - gap) / 2;
	const ph = (H - top - 66 - gap) / 2;

	// Legend: engines (colour) and workloads (dash + marker).
	const lg = svg('g');
	ENGINES.forEach((e, i) => {
		lg.append(svg('line', { x1: left + i * 190, y1: 14, x2: left + i * 190 + 34, y2: 14, style: `stroke:${e.color};stroke-width:4;` }));
		lg.append(b.svgText({ x: left + i * 190 + 42, y: 20, style: 'font-size:17px;fill:var(--fig-fg);' }, e.label));
	});
	WORKLOADS.forEach((w, i) => {
		const ly = 48 + i * 26;
		lg.append(svg('line', { x1: left, y1: ly, x2: left + 34, y2: ly, style: `stroke:var(--fig-muted);stroke-width:2.5;${w.dash ? `stroke-dasharray:${w.dash};` : ''}` }));
		lg.append(marker(w.marker, left + 17, ly, 'var(--fig-muted)'));
		lg.append(b.svgText({ x: left + 42, y: ly + 6, style: 'font-size:16px;fill:var(--fig-fg);' }, w.label));
	});
	c.append(lg);

	ROWS.forEach((row, r) => {
		COLS.forEach((col, k) => {
			const px = left + k * (pw + gap);
			const py = top + r * (ph + gap);
			const xr = xs.copy().range([px, px + pw]);
			const yr = ys.copy().range([py + ph, py]);
			const frame = svg('g');
			for (const t of [3, 10, 30, 100]) {
				frame.append(svg('line', { x1: px, x2: px + pw, y1: yr(t), y2: yr(t), style: 'stroke:var(--fig-dim);stroke-width:1;' }));
				if (k === 0) frame.append(b.svgText({ x: px - 8, y: yr(t) + 5, 'text-anchor': 'end', style: 'font-size:15px;fill:var(--fig-muted);' }, fmt(t)));
			}
			for (let e = 0; e <= 25; e += 5) {
				frame.append(svg('line', { x1: xr(e), x2: xr(e), y1: py, y2: py + ph, style: 'stroke:var(--fig-dim);stroke-width:1;' }));
				if (r === 1) frame.append(svg('text', { x: xr(e), y: py + ph + 22, 'text-anchor': 'middle', style: 'font-size:15px;fill:var(--fig-muted);' }, pow2(e)));
			}
			frame.append(svg('path', { d: `M${px},${py} V${py + ph} H${px + pw}`, style: 'fill:none;stroke:var(--fig-muted);stroke-width:1.5;' }));
			if (r === 0) frame.append(b.svgText({ x: px + pw / 2, y: py - 10, 'text-anchor': 'middle', style: 'font-size:18px;font-weight:700;fill:var(--fig-fg);' }, col.label));
			if (k === 1) frame.append(b.svgText({ x: 0, y: 0, transform: `translate(${px + pw + 22} ${py + ph / 2}) rotate(90)`, 'text-anchor': 'middle', style: 'font-size:18px;font-weight:700;fill:var(--fig-fg);' }, row.label));
			c.append(frame);

			const lines = svg('g');
			for (const e of ENGINES) {
				for (const w of WORKLOADS) {
					const pts = S[`${row.key}|${col.key}|${e.key}|${w.key}`] ?? [];
					const d = d3.line().x((p) => xr(p[0])).y((p) => yr(p[1]))(/** @type {[number, number][]} */ (pts));
					lines.append(svg('path', { d, style: `fill:none;stroke:${e.color};stroke-width:2.4;${w.dash ? `stroke-dasharray:${w.dash};` : ''}` }));
					for (const p of pts) lines.append(marker(w.marker, xr(p[0]), yr(p[1]), e.color));
				}
			}
			c.append(lines);
			b.part(lines, (s) => ({ opacity: rowVisible(s, r) ? 1 : 0, translateY: rowVisible(s, r) ? 0 : 12 }), { delay: (f, t) => (t > f ? 150 + k * 180 : 0) });
		});
	});
	c.append(b.svgText({ x: left + (W - left - 34) / 2, y: H - 14, 'text-anchor': 'middle', style: 'font-size:17px;fill:var(--fig-fg);' }, { en: 'Number of groups', de: 'Anzahl der Gruppen', uk: 'Кількість груп' }));
	c.append(b.svgText({ x: 0, y: 0, transform: `translate(26 ${top + ph + gap / 2}) rotate(-90)`, 'text-anchor': 'middle', style: 'font-size:17px;fill:var(--fig-fg);' }, { en: 'Median execution time (ms)', de: 'Median der Ausführungszeit (ms)', uk: 'Медіанний час виконання (мс)' }));
	root.append(c);
	return c;
}

/** A small marker. @param {string} kind @param {number} mx @param {number} my @param {string} color */
function marker(kind, mx, my, color) {
	const style = `fill:${color};stroke:var(--fig-bg);stroke-width:0.8;`;
	if (kind === 'square') return svg('rect', { x: mx - 3.6, y: my - 3.6, width: 7.2, height: 7.2, style });
	if (kind === 'triangle') return svg('path', { d: `M${mx},${my - 4.6} L${mx + 4.4},${my + 3.4} L${mx - 4.4},${my + 3.4}Z`, style });
	return svg('circle', { cx: mx, cy: my, r: 3.8, style });
}

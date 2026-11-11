// Plot: warm execution time by phase, relative to the slowest system per query (paper Fig. 10,
// exec_phase_breakdown_slowest), drawn with d3 from FIGDATA.execPhases (data-rtx5090/execPhaseBreakdownWarm.csv).
// As in plot_exec_phase_breakdown.py --slowest: per query the slowest system's bar is 100%, the others are scaled
// by their execution time; each bar stacks compute, materialize, merge, setup, serialize, each split into GPU busy
// (solid) and GPU idle while the host works (light). Sirius's TPC-H 6 is left out (it runs a simplified query).
import * as d3 from 'd3';
import { svg, canvas, fmt, tint, PAL } from '../lib.js';
import { FIGDATA } from '../data.js';

const R = FIGDATA.execPhases.rows;
const QUERIES = [['ssb23', 'SSB 2.3'], ['ssb34', 'SSB 3.4'], ['ssb41', 'SSB 4.1'], ['tpch1', 'TPC-H 1'], ['tpch2', 'TPC-H 2'], ['tpch3', 'TPC-H 3'], ['tpch6', 'TPC-H 6'], ['tpch9', 'TPC-H 9'], ['tpch18', 'TPC-H 18']];
const SYSTEMS = [['lingodb', 'LingoDB'], ['heavydb', 'HeavyDB'], ['gqe', 'GQE'], ['sirius', 'Sirius']];
const EXCLUDED = new Set(['sirius|tpch6']);
const PHASES = [
	{ key: 'compute', color: PAL.blue, label: { en: 'Compute', de: 'Berechnung', uk: 'Обчислення' } },
	{ key: 'materialize', color: PAL.amber, label: { en: 'Materialize', de: 'Materialisierung', uk: 'Матеріалізація' } },
	{ key: 'merge', color: PAL.green, label: { en: 'Merge', de: 'Merge', uk: 'Злиття' } },
	{ key: 'setup', color: PAL.purple, label: { en: 'Setup', de: 'Setup', uk: 'Підготовка' } },
	{ key: 'serialize', color: PAL.red, label: { en: 'Serialize', de: 'Serialisierung', uk: 'Серіалізація' } }
];

/** ms label like the paper (_fmt_ms): whole ms from 10 up, else two significant digits. @param {number} t */
const msLabel = (t) => (t >= 9.95 ? fmt(t, { maximumFractionDigits: 0 }) : fmt(t, { maximumSignificantDigits: 2 }));

/**
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number) => boolean} visible whether the figure (frame and bars) is shown in state s
 */
export function phases(b, root, x, y, visible) {
	const W = 1440;
	const H = 395;
	const c = canvas(W, H, `left:${x}px;top:${y}px;`);
	const left = 96;
	const top = 22;
	const ph = 222;
	const yv = d3.scaleLinear().domain([0, 118]).range([top + ph, top]);
	const xg = d3.scaleBand().domain(QUERIES.map((q) => q[0])).range([left, W - 10]).paddingInner(0.12).paddingOuter(0.02);
	const xb = d3.scaleBand().domain(SYSTEMS.map((s) => s[0])).range([0, xg.bandwidth()]).padding(0.1);

	for (const t of [0, 25, 50, 75, 100]) {
		c.append(svg('line', { x1: left, x2: W - 10, y1: yv(t), y2: yv(t), style: `stroke:${t ? 'var(--fig-dim)' : 'var(--fig-muted)'};stroke-width:${t ? 1 : 1.5};` }));
		c.append(b.svgText({ x: left - 10, y: yv(t) + 5, 'text-anchor': 'end', style: 'font-size:15px;fill:var(--fig-muted);' }, fmt(t / 100, { style: 'percent' })));
	}
	c.append(b.svgText({ x: 0, y: 0, transform: `translate(22 ${top + ph / 2}) rotate(-90)`, 'text-anchor': 'middle', style: 'font-size:15px;fill:var(--fig-fg);' }, { en: 'Time rel. to slowest', de: 'Zeit rel. zum langsamsten', uk: 'Час відн. найповільнішого' }));

	let n = 0;
	for (const [q, qlabel] of QUERIES) {
		const gx = xg(q) ?? 0;
		const has = SYSTEMS.filter(([s]) => R[s]?.[q] && !EXCLUDED.has(`${s}|${q}`));
		const slowest = Math.max(...has.map(([s]) => R[s][q].exec_ms));
		c.append(svg('text', { x: gx + xg.bandwidth() / 2, y: top + ph + 74, 'text-anchor': 'middle', style: 'font-size:16px;font-weight:600;fill:var(--fig-fg);' }, qlabel));
		for (const [s, sname] of SYSTEMS) {
			const bx = gx + (xb(s) ?? 0);
			const bw = xb.bandwidth();
			c.append(svg('text', { x: 0, y: 0, transform: `translate(${bx + bw / 2 + 4} ${top + ph + 8}) rotate(-45)`, 'text-anchor': 'end', style: 'font-size:11px;fill:var(--fig-muted);' }, sname));
			if (!has.some(([h]) => h === s)) continue;
			const r = R[s][q];
			const total = r.exec_ms;
			const scale = (total / slowest) * 100;
			const cols = PHASES.flatMap((p) => [[`${p.key}_gpu`, p.color], [`${p.key}_idle`, tint(p.color, 40)]]);
			const sum = cols.reduce((a, [k]) => a + r[k], 0);
			const bar = svg('g', { style: 'transform-box:fill-box;transform-origin:50% 100%;' });
			let acc = 0;
			for (const [k, color] of cols) {
				const hgt = (r[k] / sum) * scale;
				if (hgt > 0) bar.append(svg('rect', { x: bx, y: yv(acc + hgt), width: bw, height: yv(acc) - yv(acc + hgt), style: `fill:${color};stroke:var(--fig-bg);stroke-width:0.6;` }));
				acc += hgt;
			}
			const lab = b.svgText({ x: bx + bw / 2, y: yv(scale) - 5, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--fig-fg);' }, msLabel(total));
			c.append(bar, lab);
			const i = n++;
			b.part(bar, (st) => ({ scaleY: visible(st) ? 1 : 0 }), { delay: (f, t) => (t > f ? 250 + i * 18 : 0), duration: 700 });
			b.part(lab, (st) => ({ opacity: visible(st) ? 1 : 0 }), { delay: (f, t) => (t > f ? 800 + i * 18 : 0) });
		}
	}

	// Legend: each phase as busy | idle pair, plus the gray pair explaining the split.
	const lg = svg('g');
	let lx = left;
	const ly = H - 22;
	for (const p of [...PHASES, { key: 'busy', color: 'var(--fig-muted)', label: { en: 'GPU busy / idle (host)', de: 'GPU aktiv / untätig (Host)', uk: 'GPU зайнятий / простій (хост)' } }]) {
		lg.append(svg('rect', { x: lx, y: ly - 12, width: 16, height: 16, style: `fill:${p.color};` }), svg('rect', { x: lx + 16, y: ly - 12, width: 16, height: 16, style: `fill:${tint(p.color, 40)};` }));
		lg.append(b.svgText({ x: lx + 40, y: ly + 2, style: 'font-size:15px;fill:var(--fig-fg);' }, p.label));
		lx += p.key === 'busy' ? 0 : 190;
	}
	c.append(lg);
	// The frame (grid, ticks, labels, legend) is only there with the bars; otherwise it overlaps whatever chart
	// shares the slide in the other states.
	b.part(c, (st) => ({ opacity: visible(st) ? 1 : 0 }), { duration: 350 });
	root.append(c);
	return c;
}

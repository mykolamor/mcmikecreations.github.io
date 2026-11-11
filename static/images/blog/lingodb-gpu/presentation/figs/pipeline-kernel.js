// Diagram: relational operators fused into one pipeline kernel (paper Fig. 4), redrawn from
// figures/implementation/pipeline-kernel.tex: same operators, code lines, highlights and connectors.
import { svg, arrow, tint, PAL, canvas } from '../lib.js';

const LH = 23; // code line height
const Y0 = 40; // baseline of line 1
const GX = 212; // right edge of the line numbers
const CX = 222; // code start
const CW = 8.6; // monospace advance at 14.5px
const lineY = (/** @type {number} */ i) => (i < 12 ? Y0 + i * LH : Y0 + i * LH + 12);

/** Code lines, indent level, text. Only the comment is prose, so only it is translated. */
const CODE = [
	[0, 'Kernel pipeline(ResultTable* localStates):'],
	[1, 'if thread.id_in_warp == 0:'],
	[2, 'localState = createResultTable()'],
	[2, 'localStates[warp.id] = localState'],
	[1, 'while True:'],
	[2, 'if thread.id == 0:'],
	[3, 'batch, ok = nextBatch()'],
	[2, 'if(!ok) break;'],
	[2, 'for i = thread.id; i < batch.size; i += block.size:'],
	[3, "B:= batch['B'][i]; A:= batch['A'][i];"],
	[3, 'if B < 5:'],
	[4, 'localState.append(A)'],
	[0, 'Kernel merge(ResultTable* localStates, ResultTable* res):'],
	[1, null]
];
const COMMENT = { en: '// merge all localStates into res', de: '// alle localStates in res zusammenführen', uk: '// злити всі localStates у res' };

/**
 * Builds the diagram into `root` at (x, y). `emph(s)` says which highlight group is emphasised per state:
 * 'state' (local state + merge), 'loop' (virtual-processor loop, lines 5–8) or null.
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number) => 'state' | 'loop' | null} emph
 */
export function pipelineKernel(b, root, x, y, emph) {
	const W = 750;
	const H = 384;
	const c = canvas(W, H, `left:${x}px;top:${y}px;`);
	const hl = (/** @type {number} */ i0, /** @type {number} */ i1, /** @type {string} */ fill, right = 712) =>
		svg('rect', { x: 186, y: lineY(i0) - 17, width: right - 186, height: lineY(i1) - lineY(i0) + LH, rx: 4, style: `fill:${fill};` });

	// Frame and highlights (background).
	c.append(svg('rect', { x: 180, y: 6, width: 556, height: H - 12, rx: 10, style: 'fill:color-mix(in oklab, var(--fig-fg) 3%, var(--fig-bg));stroke:var(--fig-dim);stroke-width:1.5;' }));
	const hScan = hl(8, 9, tint(PAL.blue, 30));
	const hSel = hl(10, 10, tint(PAL.amber, 38));
	const hProj = hl(11, 11, tint(PAL.green, 38));
	const hState = hl(3, 3, tint(PAL.purple, 32));
	const hMerge = hl(12, 12, tint(PAL.purple, 28), 730);
	const hLoop = svg('rect', { x: 186, y: lineY(4) - 17, width: 526, height: lineY(7) - lineY(4) + LH, rx: 4, style: 'fill:none;stroke:var(--fig-accent2);stroke-width:3;stroke-dasharray:8 5;' });
	c.append(hScan, hSel, hProj, hState, hMerge, hLoop);

	// Code.
	const code = svg('g', { style: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14.5px;fill:var(--fig-fg);white-space:pre;' });
	CODE.forEach(([lvl, text], i) => {
		const ty = lineY(i);
		if (i < 12) code.append(svg('text', { x: GX, y: ty, 'text-anchor': 'end', style: 'fill:var(--fig-muted);font-size:12px;' }, String(i + 1)));
		const tx = CX + Number(lvl) * 2 * CW;
		code.append(text == null ? b.svgText({ x: tx, y: ty, style: 'fill:var(--fig-muted);' }, COMMENT) : svg('text', { x: tx, y: ty }, String(text)));
	});
	c.append(code);

	// Operators (left) and their connectors.
	const ops = [
		{ name: 'TableScan', sub: 'T', y: 96, fill: tint(PAL.blue, 45), stroke: PAL.blue, to: hScan, ty: (lineY(8) + lineY(9)) / 2 - 6 },
		{ name: 'Selection', sub: 'B < 5', y: 186, fill: tint(PAL.amber, 55), stroke: PAL.amber, to: hSel, ty: lineY(10) - 6 },
		{ name: 'Projection', sub: 'A', y: 276, fill: tint(PAL.green, 50), stroke: PAL.green, to: hProj, ty: lineY(11) - 6 }
	];
	c.append(b.svgText({ x: 75, y: 82, 'text-anchor': 'middle', style: 'font-size:16px;font-weight:700;fill:var(--fig-fg);' }, { en: 'Query pipeline', de: 'Anfrage-Pipeline', uk: 'Конвеєр запиту' }));
	ops.forEach((o, i) => {
		const g = svg('g');
		g.append(
			svg('rect', { x: 10, y: o.y, width: 130, height: 54, rx: 6, style: `fill:${o.fill};stroke:var(--fig-fg);stroke-width:2;` }),
			svg('text', { x: 75, y: o.y + 24, 'text-anchor': 'middle', style: 'font-size:16px;font-weight:700;fill:var(--fig-fg);' }, o.name),
			svg('text', { x: 75, y: o.y + 44, 'text-anchor': 'middle', style: 'font-size:14px;font-style:italic;fill:var(--fig-fg);' }, o.sub)
		);
		c.append(g);
		if (i < 2) c.append(arrow([75, o.y + 54], [75, o.y + 88], { width: 3, color: 'var(--fig-muted)' }));
		const from = /** @type {[number, number]} */ ([140, o.y + 27]);
		const to = /** @type {[number, number]} */ ([186, o.ty]);
		c.append(arrow(from, to, { c1: [165, from[1]], c2: [165, to[1]], width: 2.5, dash: '6 4', color: o.stroke }));
	});

	// Local states -> merge kernel.
	const sy = lineY(3) - 6;
	const flow = svg('g');
	flow.append(
		svg('path', { d: `M712,${sy} H726 V${lineY(12) - 30}`, style: `fill:none;stroke:${PAL.purple};stroke-width:2.5;stroke-dasharray:6 4;` }),
		arrow([726, lineY(12) - 30], [726, lineY(12) - 16], { width: 2.5, color: PAL.purple }),
		b.svgText({ x: 716, y: lineY(2) + 4, 'text-anchor': 'end', style: `font-size:13px;font-style:italic;fill:${PAL.purple};` }, { en: 'local states', de: 'lokale Zustände', uk: 'локальні стани' })
	);
	c.append(flow);

	// Per-state emphasis: the active group is full strength, the other highlights fade a little.
	const on = (/** @type {number} */ s, /** @type {'state' | 'loop'} */ k) => emph(s) === k;
	b.part(hLoop, (s) => ({ opacity: on(s, 'loop') ? 1 : 0 }));
	for (const el of [hState, hMerge, flow]) b.part(el, (s) => ({ opacity: emph(s) === 'loop' ? 0.35 : 1 }));
	for (const el of [hScan, hSel, hProj]) b.part(el, (s) => ({ opacity: emph(s) == null ? 1 : 0.55 }));
	root.append(c);
	return c;
}

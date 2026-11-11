// Diagram: LingoDB's lowering pipeline from SQL to machine code (paper Fig. 7), redrawn from
// figures/implementation/system-gpu.tex: the same layers (relalg/db/arith → subop/db/arith → util/arith/scf/gpu
// → llvm + gpu(llvm) → llvm + gpu(#PTX)), passes, the CPU/GPU split, the MLIR region, the runtime and steps ①–④.
import { svg, arrow, tint, PAL, canvas } from '../lib.js';

const MONO = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;';
const T = {
	parse: { en: 'Parsing & Module Creation', de: 'Parsen & Modulerzeugung', uk: 'Парсинг і створення модуля' },
	queryOpt: { en: 'Query Opt.', de: 'Anfrageopt.', uk: 'Опт. запиту' },
	opt: { en: 'Opt.', de: 'Opt.', uk: 'Опт.' },
	lowerings: { en: 'Lowerings', de: 'Lowerings', uk: 'Пониження' },
	compile: { en: 'compile kernels', de: 'Kernel kompilieren', uk: 'компіляція ядер' },
	translate: { en: 'translate', de: 'übersetzen', uk: 'трансляція' },
	machine: { en: 'machine code', de: 'Maschinencode', uk: 'машинний код' },
	runtime: { en: 'Runtime', de: 'Laufzeit', uk: 'Середовище виконання' },
	devRt: { en: 'Device Runtime', de: 'Geräte-Laufzeit', uk: 'Рантайм пристрою' },
	devFn: { en: 'device functions', de: 'Gerätefunktionen', uk: 'функції пристрою' },
	hostRt: { en: 'Host Runtime', de: 'Host-Laufzeit', uk: 'Рантайм хоста' },
	hostFn1: { en: 'Tables, Sorting,', de: 'Tabellen, Sortierung,', uk: 'Таблиці, сортування,' },
	hostFn2: { en: 'Kernel Launch', de: 'Kernel-Start', uk: 'запуск ядер' },
	bitcode: { en: 'LLVM bitcode', de: 'LLVM-Bitcode', uk: 'LLVM-біткод' },
	compileDev: { en: 'compile', de: 'kompilieren', uk: 'компіляція' },
	link: { en: 'link', de: 'linken', uk: 'лінкування' },
	calls: { en: 'Runtime Calls', de: 'Laufzeitaufrufe', uk: 'Виклики рантайму' },
	mlir: { en: 'MLIR', de: 'MLIR', uk: 'MLIR' }
};

/**
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number) => 'all' | 'subop' | 'runtime'} emph which groups stay at full strength per state
 */
export function lowering(b, root, x, y, emph) {
	const c = canvas(610, 610, `left:${x}px;top:${y}px;`);
	const groups = { top: svg('g'), subop: svg('g'), gpu: svg('g'), kernels: svg('g'), host: svg('g'), rt: svg('g') };
	const txt = (/** @type {SVGElement} */ g, /** @type {number} */ tx, /** @type {number} */ ty, /** @type {any} */ loc, style = '', anchor = 'start') =>
		g.append(b.svgText({ x: tx, y: ty, 'text-anchor': anchor, style: `font-size:14px;fill:var(--fig-fg);${style}` }, loc));
	const chip = (/** @type {SVGElement} */ g, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ w, /** @type {string} */ label, /** @type {string | null} */ fill, dashed = false, hh = 30) => {
		g.append(
			svg('rect', { x: cx, y: cy, width: w, height: hh, rx: 9, style: `fill:${fill ?? 'none'};stroke:var(--fig-fg);stroke-width:1.6;${dashed ? 'stroke-dasharray:4 3;' : ''}` }),
			svg('text', { x: cx + w / 2, y: cy + hh / 2 + 5, 'text-anchor': 'middle', style: 'font-size:14px;fill:var(--fig-fg);' }, label)
		);
		return cx + w + 5;
	};
	/** A layer: chips in a box. @returns {{ x0: number, x1: number, y0: number, y1: number }} */
	const layer = (/** @type {SVGElement} */ g, /** @type {number} */ lx, /** @type {number} */ ly, /** @type {[string, string | null, boolean?][]} */ chips) => {
		let cx = lx + 6;
		for (const [label, fill, dashed] of chips) cx = chip(g, cx, ly + 6, label === '…' ? 30 : Math.max(44, label.length * 9 + 14), label, fill, dashed);
		g.append(svg('rect', { x: lx, y: ly, width: cx - lx + 1, height: 42, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.6;' }));
		return { x0: lx, x1: cx + 1, y0: ly, y1: ly + 42 };
	};
	const badge = (/** @type {SVGElement} */ g, /** @type {number} */ bx, /** @type {number} */ by, /** @type {any} */ loc, /** @type {string} */ fill, w = 0) => {
		const width = w || (typeof loc === 'string' ? loc.length * 7.6 + 10 : 0);
		g.append(svg('rect', { x: bx, y: by, width, height: 20, style: `fill:${fill};` }));
		if (typeof loc === 'string') g.append(svg('text', { x: bx + 5, y: by + 15, style: `${MONO}font-size:12.5px;fill:var(--fig-fg);` }, loc));
		else txt(g, bx + 5, by + 15, loc, `${MONO}font-size:12.5px;`);
	};
	const step = (/** @type {SVGElement} */ g, /** @type {number} */ sx, /** @type {number} */ sy, /** @type {string} */ n) =>
		g.append(svg('circle', { cx: sx, cy: sy, r: 10, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.5;' }), svg('text', { x: sx, y: sy + 5, 'text-anchor': 'middle', style: 'font-size:13px;fill:var(--fig-fg);' }, n));

	const blue = tint(PAL.blue, 40);
	const gray = tint('var(--fig-muted)', 22);
	const amber = tint(PAL.amber, 50);
	const green = tint(PAL.green, 45);
	const G = groups;

	// ① input
	chip(G.top, 92, 12, 50, 'SQL', null);
	chip(G.top, 147, 12, 30, '…', null);
	G.top.append(svg('rect', { x: 86, y: 6, width: 98, height: 42, rx: 12, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.5;stroke-dasharray:5 4;' }));
	step(G.top, 70, 18, '1');
	// ② relalg layer + query optimization loop
	const A = layer(G.top, 30, 86, [['relalg', blue], ['db', blue], ['arith', gray], ['…', null, true]]);
	step(G.top, 18, 92, '2');
	G.top.append(arrow([138, 50], [138, 84], { width: 4 }));
	txt(G.top, 148, 72, T.parse, 'font-size:13px;');
	G.top.append(svg('path', { d: `M${A.x1},${A.y0 + 10} C${A.x1 + 30},${A.y0 + 10} ${A.x1 + 30},${A.y1 - 10} ${A.x1 + 6},${A.y1 - 10}`, style: 'fill:none;stroke:var(--fig-fg);stroke-width:2;' }));
	G.top.append(arrow([A.x1 + 8, A.y1 - 10], [A.x1, A.y1 - 10], { width: 2 }));
	badge(G.top, A.x1 + 32, A.y0 + 10, T.queryOpt, tint(PAL.blue, 45), 92);

	// subop layer, passes
	const B = layer(G.subop, 30, 166, [['subop', amber], ['db', blue], ['arith', gray], ['…', null, true]]);
	G.subop.append(arrow([138, A.y1 + 2], [138, B.y0 - 2], { width: 4 }));
	badge(G.subop, 148, A.y1 + 8, '--to-subop', amber);
	G.subop.append(svg('path', { d: `M${B.x1},${B.y0 + 10} C${B.x1 + 30},${B.y0 + 10} ${B.x1 + 30},${B.y1 - 10} ${B.x1 + 6},${B.y1 - 10}`, style: 'fill:none;stroke:var(--fig-fg);stroke-width:2;' }));
	G.subop.append(arrow([B.x1 + 8, B.y1 - 10], [B.x1, B.y1 - 10], { width: 2 }));
	badge(G.subop, B.x1 + 32, B.y0 + 4, T.opt, amber, 44);
	badge(G.subop, B.x1 + 32, B.y0 + 28, 'Place', green);
	badge(G.subop, B.x1 + 32, B.y0 + 51, 'ParallelizeGPU', green);
	// split: CPU (left, "…") and GPU (right)
	G.subop.append(arrow([66, B.y1 + 4], [66, 296], { width: 4 }));
	G.subop.append(svg('text', { x: 66, y: 252, 'text-anchor': 'middle', style: `${MONO}font-size:12.5px;fill:var(--fig-fg);paint-order:stroke;stroke:var(--fig-bg);stroke-width:6;` }, '--lower-subop'));
	G.subop.append(svg('text', { x: 66, y: 318, 'text-anchor': 'middle', style: 'font-size:22px;fill:var(--fig-fg);' }, '…'));
	G.subop.append(arrow([214, B.y1 + 4], [214, 298], { width: 4 }));
	badge(G.subop, 164, 240, '--lower-subop', green);

	// GPU layer
	layer(G.gpu, 110, 300, [['util', blue], ['arith', gray], ['scf', gray], ['gpu', green]]);
	// ③ llvm + gpu(llvm)
	const kern = (/** @type {SVGElement} */ g, /** @type {number} */ ky, /** @type {boolean} */ ptx) => {
		chip(g, 116, ky + 7, 48, 'llvm', gray);
		g.append(svg('rect', { x: 172, y: ky + 4, width: 140, height: 36, rx: 9, style: `fill:${green};stroke:var(--fig-fg);stroke-width:1.6;` }));
		g.append(svg('text', { x: 180, y: ky + 27, style: 'font-size:13px;fill:var(--fig-fg);' }, 'gpu'));
		if (ptx) g.append(svg('text', { x: 304, y: ky + 27, 'text-anchor': 'end', style: `${MONO}font-size:13px;fill:var(--fig-fg);` }, '#PTX'));
		else chip(g, 252, ky + 10, 54, 'llvm', gray, false, 24);
		g.append(svg('rect', { x: 110, y: ky, width: 208, height: 44, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.6;' }));
	};
	kern(G.gpu, 384, false);
	step(G.gpu, 98, 390, '3');
	G.gpu.append(arrow([214, 344], [214, 382], { width: 4 }));
	txt(G.gpu, 224, 368, T.lowerings, 'font-size:13px;');
	kern(G.kernels, 474, true);
	G.kernels.append(arrow([214, 430], [214, 472], { width: 4 }));
	txt(G.kernels, 224, 456, T.compile, 'font-size:13px;');

	// MLIR region (dashed) with its rotated label.
	c.append(svg('rect', { x: 8, y: 78, width: 330, height: 446, rx: 4, style: 'fill:none;stroke:var(--fig-muted);stroke-width:1.5;stroke-dasharray:6 5;' }));
	c.append(b.svgText({ x: 0, y: 0, transform: 'translate(13 470) rotate(-90)', 'text-anchor': 'middle', style: 'font-size:13px;fill:var(--fig-muted);paint-order:stroke;stroke:var(--fig-bg);stroke-width:8;' }, T.mlir));

	// Host compilation: translate → LLVM IR → LLVM → machine code.
	G.host.append(arrow([140, 520], [140, 556], { width: 3 }));
	txt(G.host, 132, 544, T.translate, 'font-size:13px;', 'end');
	G.host.append(svg('rect', { x: 84, y: 558, width: 112, height: 32, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.6;' }));
	G.host.append(svg('text', { x: 140, y: 579, 'text-anchor': 'middle', style: 'font-size:14px;fill:var(--fig-fg);' }, 'LLVM IR'));
	G.host.append(arrow([196, 574], [300, 574], { width: 3 }));
	G.host.append(svg('text', { x: 248, y: 566, 'text-anchor': 'middle', style: 'font-size:13px;fill:var(--fig-fg);' }, 'LLVM'));
	G.host.append(svg('rect', { x: 300, y: 558, width: 136, height: 32, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.6;' }));
	txt(G.host, 368, 579, T.machine, '', 'middle');

	// ④ runtime: device (feeds kernel compilation) and host (called by the machine code).
	const R = G.rt;
	R.append(svg('rect', { x: 430, y: 300, width: 166, height: 160, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.6;' }));
	step(R, 600, 290, '4');
	txt(R, 513, 320, T.runtime, 'font-weight:700;font-size:14px;', 'middle');
	R.append(svg('rect', { x: 440, y: 330, width: 146, height: 28, style: `fill:${green};stroke:var(--fig-fg);stroke-width:1.4;` }));
	txt(R, 513, 349, T.devRt, 'font-size:13.5px;', 'middle');
	txt(R, 513, 375, T.devFn, 'font-size:12.5px;fill:var(--fig-muted);', 'middle');
	R.append(svg('rect', { x: 440, y: 388, width: 146, height: 28, style: `fill:${blue};stroke:var(--fig-fg);stroke-width:1.4;` }));
	txt(R, 513, 407, T.hostRt, 'font-size:13.5px;', 'middle');
	R.append(b.svgText({ x: 513, y: 433, 'text-anchor': 'middle', style: 'font-size:12px;fill:var(--fig-muted);' }, T.hostFn1));
	R.append(b.svgText({ x: 513, y: 449, 'text-anchor': 'middle', style: 'font-size:12px;fill:var(--fig-muted);' }, T.hostFn2));
	R.append(svg('rect', { x: 352, y: 380, width: 70, height: 42, style: 'fill:var(--fig-bg);stroke:var(--fig-fg);stroke-width:1.4;' }));
	R.append(b.svgText({ x: 387, y: 397, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--fig-fg);' }, { en: 'LLVM', de: 'LLVM', uk: 'LLVM' }));
	R.append(b.svgText({ x: 387, y: 413, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--fig-fg);' }, { en: 'bitcode', de: 'Bitcode', uk: 'біткод' }));
	R.append(arrow([440, 344], [387, 378], { c1: [400, 344], c2: [387, 350], width: 2, dash: '5 4' }));
	// Both arrow labels get a background halo (as the MLIR label) so the region border and arrows don't cut them.
	const halo = 'paint-order:stroke;stroke:var(--fig-bg);stroke-width:6;stroke-linejoin:round;';
	txt(R, 396, 338, T.compileDev, `font-size:12px;${halo}`, 'end');
	R.append(arrow([352, 401], [300, 452], { c1: [320, 401], c2: [300, 420], width: 2, dash: '5 4' }));
	txt(R, 320, 432, T.link, `font-size:12px;${halo}`, 'start');
	R.append(arrow([436, 574], [596, 402], { c1: [600, 574], c2: [630, 402], width: 3 }));
	txt(R, 520, 600, T.calls, 'font-size:13px;', 'middle');

	c.append(...Object.values(groups));
	/** @type {Record<string, string[]>} */
	const strong = { all: Object.keys(groups), subop: ['subop', 'gpu'], runtime: ['kernels', 'host', 'rt'] };
	for (const [k, g] of Object.entries(groups)) b.part(g, (s) => ({ opacity: strong[emph(s)].includes(k) ? 1 : 0.3 }));
	root.append(c);
	return c;
}

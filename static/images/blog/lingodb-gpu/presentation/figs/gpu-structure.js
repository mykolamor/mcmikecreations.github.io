// Diagram: GPU architecture outline (paper Fig. 1), redrawn from figures/implementation/gpu-structure.tex.
// Same layout in TikZ units (scaled by K): a zoomed SM with 4×4 warps, two thread-block outlines,
// registers and shared memory; two SMs + "…" over L2 and global memory; a magnifier; the kernel launch.
import { svg, arrow, tint, PAL, canvas } from '../lib.js';

const K = 62; // px per TikZ unit
const TOP = 7.05; // TikZ y of the canvas top

const L = {
	sm: { en: 'SM', de: 'SM', uk: 'SM' },
	smem: { en: 'Shared Memory', de: 'Shared Memory', uk: 'Спільна пам’ять' },
	smemL1: { en: 'Shared Memory / L1 Cache', de: 'Shared Memory / L1-Cache', uk: 'Спільна пам’ять / кеш L1' },
	regs: { en: 'Registers', de: 'Register', uk: 'Регістри' },
	l2: { en: 'L2 Cache', de: 'L2-Cache', uk: 'Кеш L2' },
	global: { en: 'Global Memory', de: 'Globaler Speicher', uk: 'Глобальна пам’ять' },
	dims: { en: '#blocks × #threads/block', de: '#Blöcke × #Threads/Block', uk: '#блоків × #потоків/блок' },
	kernel: { en: 'kernel', de: 'Kernel', uk: 'ядро' }
};

/** TikZ → px. @param {number} x @param {number} y @returns {[number, number]} */
const T = (x, y) => [x * K, (TOP - y) * K];

/**
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number) => 'blocks' | 'memory'} emph which part to highlight per state
 */
export function gpuStructure(b, root, x, y, emph) {
	const c = canvas(860, 450, `left:${x}px;top:${y}px;`);
	/** @type {SVGElement[]} */ const memHl = [];
	/** @type {SVGElement[]} */ const blockHl = [];

	const rect = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {string} */ style) => {
		const [ax, ay] = T(x0, y1);
		const [bx, by] = T(x1, y0);
		return svg('rect', { x: ax, y: ay, width: bx - ax, height: by - ay, style });
	};
	const label = (/** @type {number} */ tx, /** @type {number} */ ty, /** @type {any} */ loc, /** @type {number} */ size, extra = '') => {
		const [px, py] = T(tx, ty);
		return b.svgText({ x: px, y: py + size * 0.35, 'text-anchor': 'middle', style: `font-size:${size}px;fill:var(--fig-fg);${extra}` }, loc);
	};

	/** One SM, as \drawSM in the TikZ source. */
	const drawSM = (/** @type {number} */ sx, /** @type {number} */ sy, /** @type {number} */ w, /** @type {number} */ hh, /** @type {any} */ memLabel, /** @type {boolean} */ blocks, /** @type {number} */ fs) => {
		const pad = 0.1 * w;
		const busH = 0.11 * hh;
		const gap = 0.03 * hh;
		const line = 'fill:none;stroke:var(--fig-fg);stroke-width:2;';
		// Highlight overlays for the memory state (registers + shared memory).
		for (const by of [pad, pad + busH + gap]) {
			const o = rect(sx + pad, sy + by, sx + w - pad, sy + by + busH, `fill:${tint(PAL.amber, 45)};`);
			memHl.push(o);
			c.append(o);
		}
		c.append(rect(sx + pad, sy + pad, sx + w - pad, sy + pad + busH, line));
		c.append(label(sx + w / 2, sy + pad + busH / 2, memLabel, fs));
		const regy = pad + busH + gap;
		c.append(rect(sx + pad, sy + regy, sx + w - pad, sy + regy + busH, line));
		c.append(label(sx + w / 2, sy + regy + busH / 2, L.regs, fs));
		const gbot = regy + busH + gap;
		const gtop = hh - pad;
		const cw = (w - 2 * pad) / 4;
		const ch = (gtop - gbot) / 4;
		for (let i = 0; i < 4; i++) {
			for (let j = 0; j < 4; j++) {
				const x0 = sx + pad + i * cw;
				const y0 = sy + gbot + j * ch;
				c.append(rect(x0, y0, x0 + cw, y0 + ch, 'fill:none;stroke:var(--fig-muted);stroke-width:1;'));
				for (let t = 0; t < 4; t++) {
					const tx = x0 + (0.32 + t * 0.12) * cw;
					const ty = y0 + 0.24 * ch;
					const sq = (0.52 * ch) / 4;
					const amp = 0.045 * cw;
					const p = [[tx, ty], [tx + amp, ty + sq], [tx - amp, ty + 2 * sq], [tx + amp, ty + 3 * sq], [tx, ty + 4 * sq]].map(([u, v]) => T(u, v));
					c.append(svg('path', { d: `M${p[0]} C${p[1]} ${p[2]} ${p[2]} S${p[3]} ${p[4]}`, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1;opacity:0.7;' }));
				}
			}
		}
		if (blocks) {
			const bgap = 0.012 * w;
			for (const [a, z] of [[pad, pad + 2 * cw - bgap], [pad + 2 * cw + bgap, w - pad]]) {
				const blk = rect(sx + a, sy + gbot + ch, sx + z, sy + gbot + 4 * ch, `fill:color-mix(in oklab, ${PAL.purple} 14%, transparent);stroke:${PAL.purple};stroke-width:3.5;`);
				blk.setAttribute('rx', '4');
				blockHl.push(blk);
				c.append(blk);
			}
		}
		c.append(rect(sx, sy, sx + w, sy + hh, 'fill:none;stroke:var(--fig-fg);stroke-width:2.5;'));
		// The zoomed SM's title sits at its left edge, clear of the kernel launch above it.
		const [tx, ty] = T(blocks ? sx : sx + w / 2, sy + hh + 0.22);
		c.append(b.svgText({ x: tx, y: ty + fs * 0.35, 'text-anchor': blocks ? 'start' : 'middle', style: `font-size:${fs}px;font-weight:700;fill:var(--fig-fg);` }, L.sm));
	};

	// Main SM array, L2 and global memory.
	const smw = 2.4;
	const smh = 3.3;
	const arrx = 7.0;
	const smy = 1.35;
	drawSM(arrx, smy, smw, smh, L.smem, false, 12);
	drawSM(arrx + smw + 0.5, smy, smw, smh, L.smem, false, 12);
	const dotsx = arrx + 2 * smw + 1.0 + 0.15;
	c.append(label(dotsx, smy + smh / 2, { en: '⋯', de: '⋯', uk: '⋯' }, 30));
	const busR = dotsx + 0.6;
	const l2hl = rect(arrx, 0.72, busR, 1.18, `fill:${tint(PAL.blue, 40)};`);
	memHl.push(l2hl);
	c.append(rect(arrx, 0.72, busR, 1.18, `fill:${tint('var(--fig-muted)', 22)};stroke:var(--fig-fg);stroke-width:2;`), l2hl);
	c.append(label((arrx + busR) / 2, 0.95, L.l2, 15));
	c.append(rect(arrx, 0.1, busR, 0.56, `fill:${tint('var(--fig-muted)', 22)};stroke:var(--fig-fg);stroke-width:2;`));
	c.append(label((arrx + busR) / 2, 0.33, L.global, 15));

	// Zoomed SM (left).
	const zw = 3.9;
	const zh = 5.3;
	const zx = 0.4;
	const zy = 0.3;
	drawSM(zx, zy, zw, zh, L.smemL1, true, 15);

	// Magnifier over the first SM, with dashed lines to the zoomed one.
	const [mx, my] = T(arrx + smw / 2, smy + smh / 2 + 0.05);
	const mr = 1.85 * K;
	const [zTRx, zTRy] = T(zx + zw, zy + zh);
	const [zBRx, zBRy] = T(zx + zw, zy);
	c.append(
		svg('line', { x1: mx - mr * 0.72, y1: my - mr * 0.69, x2: zTRx, y2: zTRy, style: 'stroke:var(--fig-muted);stroke-width:2;stroke-dasharray:7 5;' }),
		svg('line', { x1: mx - mr * 0.72, y1: my + mr * 0.69, x2: zBRx, y2: zBRy, style: 'stroke:var(--fig-muted);stroke-width:2;stroke-dasharray:7 5;' }),
		svg('circle', { cx: mx, cy: my, r: mr, style: 'fill:none;stroke:var(--fig-fg);stroke-width:5;opacity:0.85;' }),
		svg('line', { x1: mx + mr * 0.72, y1: my + mr * 0.69, x2: mx + mr * 0.72 + 0.55 * K, y2: my + mr * 0.69 + 0.55 * K, style: 'stroke:var(--fig-fg);stroke-width:8;stroke-linecap:round;opacity:0.85;' })
	);

	// Kernel launch: ( #blocks × #threads/block / kernel ) with arrows to the two thread-blocks.
	const [lx, ly] = T(2.35, 6.7);
	const launch = svg('g');
	launch.append(
		b.svgText({ x: lx, y: ly, 'text-anchor': 'middle', style: 'font-size:17px;fill:var(--fig-fg);' }, L.dims),
		svg('rect', { x: lx - 40, y: ly + 10, width: 80, height: 28, rx: 6, style: `fill:${tint(PAL.purple, 35)};stroke:var(--fig-fg);stroke-width:2;` }),
		b.svgText({ x: lx, y: ly + 30, 'text-anchor': 'middle', style: 'font-size:15px;fill:var(--fig-fg);' }, L.kernel),
		svg('text', { x: lx - 130, y: ly + 26, 'text-anchor': 'middle', style: 'font-size:58px;font-weight:200;fill:var(--fig-fg);' }, '('),
		svg('text', { x: lx + 130, y: ly + 26, 'text-anchor': 'middle', style: 'font-size:58px;font-weight:200;fill:var(--fig-fg);' }, ')')
	);
	const zpad = 0.1 * zw;
	const zgtop = zh - zpad;
	const start = /** @type {[number, number]} */ ([lx, ly + 46]);
	const t1 = T(zx + zpad + 0.15, zy + zgtop - 0.15);
	const t2 = T(zx + zw - zpad - 0.15, zy + zgtop - 0.15);
	const arrows = svg('g');
	arrows.append(
		arrow(start, t1, { c1: [start[0] - 60, start[1] + 20], c2: [t1[0] + 10, t1[1] - 40], width: 3.5, color: 'var(--fig-fg)' }),
		arrow(start, t2, { c1: [start[0] + 60, start[1] + 20], c2: [t2[0] - 10, t2[1] - 40], width: 3.5, color: 'var(--fig-fg)' })
	);
	c.append(launch, arrows);

	// Per-state emphasis: thread-blocks and the launch, or the memories.
	for (const el of [...blockHl, launch, arrows]) b.part(el, (s) => ({ opacity: emph(s) === 'blocks' ? 1 : 0.35 }));
	for (const el of memHl) b.part(el, (s) => ({ opacity: emph(s) === 'memory' ? 1 : 0 }));
	root.append(c);
	return c;
}

// Diagram: the grouped-aggregation design (paper Fig. 6), redrawn from figures/implementation/aggregation.tex
// in its TikZ coordinates (scaled by K): warp sub-groups → per-warp cache W → per-block directory, the three
// scenarios (hit / miss+hit / miss+append), then partitions P_i written by every thread-block, merge blocks B_i,
// local hash tables and the aggregated result.
import { svg, arrow, tint, PAL, canvas } from '../lib.js';

const K = 66;
const X = (/** @type {number} */ u) => (u + 1.15) * K;
const Y = (/** @type {number} */ v) => (3.05 - v) * K + 12;
/** @returns {[number, number]} */
const P = (/** @type {number} */ u, /** @type {number} */ v) => [X(u), Y(v)];

const SA = PAL.blue; // (1) hit in the per-warp cache
const SB = PAL.purple; // (2) miss in the cache, hit in the directory
const SC = PAL.red; // (3) miss, miss → append

const L = {
	warp: { en: 'warp', de: 'Warp', uk: 'warp' },
	threads32: { en: '32 threads', de: '32 Threads', uk: '32 потоки' },
	subgroup: { en: 'one sub-group\nper equal hash', de: 'eine Untergruppe\npro gleichem Hash', uk: 'одна підгрупа\nна однаковий хеш' },
	wTitle: { en: 'W: per-warp cache', de: 'W: Cache pro Warp', uk: 'W: кеш на warp' },
	wSub: { en: 'probed once per sub-group (by the leader)', de: 'einmal pro Untergruppe abgefragt (vom Leader)', uk: 'перевіряється раз на підгрупу (лідером)' },
	wCap: { en: 'direct-mapped, k slots,\nindexed by h & mask', de: 'direkt abgebildet, k Slots,\nIndex h & mask', uk: 'пряме відображення, k слотів,\nіндекс h & mask' },
	dTitle: { en: 'per-block directory', de: 'Verzeichnis pro Block', uk: 'каталог на блок' },
	dSub: { en: 'accessed by every thread separately', de: 'von jedem Thread einzeln genutzt', uk: 'кожен потік звертається окремо' },
	dCap: { en: 'c slots: hash | lock | ptr,\nindexed by h & mask', de: 'c Slots: Hash | Lock | Zeiger,\nIndex h & mask', uk: 'c слотів: хеш | блок. | вказ.,\nіндекс h & mask' },
	hit: { en: 'hit, reduce', de: 'Treffer, reduzieren', uk: 'влучання, редукція' },
	miss: { en: 'miss', de: 'Fehlschlag', uk: 'промах' },
	leader: { en: '1 thread (leader)', de: '1 Thread (Leader)', uk: '1 потік (лідер)' },
	all: { en: 'all threads (no leader)', de: 'alle Threads (kein Leader)', uk: 'усі потоки (без лідера)' },
	tb: { en: 'one thread-block b₀ (of many)', de: 'ein Thread-Block b₀ (von vielen)', uk: 'один блок потоків b₀ (з багатьох)' },
	pre: { en: 'Pre-Aggregation Phase', de: 'Vor-Aggregationsphase', uk: 'Фаза попередньої агрегації' },
	merge: { en: 'Merge Phase', de: 'Merge-Phase', uk: 'Фаза злиття' },
	brace1: { en: 'thread-blocks: each writes', de: 'Thread-Blöcke: jeder schreibt', uk: 'блоки потоків: кожен пише' },
	brace2: { en: '256 logical partitions (by hash)', de: '256 logische Partitionen (nach Hash)', uk: '256 логічних розділів (за хешем)' },
	mBlocks: { en: 'merge blocks', de: 'Merge-Blöcke', uk: 'блоки злиття' },
	mSub: { en: '256, one per Pᵢ', de: '256, einer pro Pᵢ', uk: '256, по одному на Pᵢ' },
	hts1: { en: 'local hash', de: 'lokale', uk: 'локальні' },
	hts2: { en: 'tables', de: 'Hashtabellen', uk: 'хеш-таблиці' },
	agg: { en: 'aggregate', de: 'aggregieren', uk: 'агрегація' },
	hitAgg: { en: 'hit, aggregate', de: 'Treffer, aggregieren', uk: 'влучання, агрегація' },
	missApp: { en: 'miss, append', de: 'Fehlschlag, anhängen', uk: 'промах, додавання' },
	result1: { en: 'aggregated', de: 'aggregiertes', uk: 'агрегований' },
	result2: { en: 'result', de: 'Ergebnis', uk: 'результат' }
};

/**
 * @param {any} b builder @param {HTMLElement} root @param {number} x @param {number} y
 * @param {(s: number) => 'all' | 'pre' | 'merge'} emph which phase stays at full strength per state
 */
export function aggregationDesign(b, root, x, y, emph) {
	const c = canvas(1440, 380, `left:${x}px;top:${y}px;`);
	const pre = svg('g');
	const merge = svg('g');
	const t = (/** @type {SVGElement} */ g, /** @type {[number, number]} */ at, /** @type {any} */ loc, style = '', anchor = 'middle') =>
		g.append(typeof loc === 'string'
			? svg('text', { x: at[0], y: at[1], 'text-anchor': anchor, style: `font-size:14px;fill:var(--fig-fg);${style}` }, loc)
			: b.svgText({ x: at[0], y: at[1], 'text-anchor': anchor, style: `font-size:14px;fill:var(--fig-fg);${style}` }, loc));
	const cell = (/** @type {SVGElement} */ g, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ w, /** @type {number} */ hh, /** @type {string} */ fill, extra = '') =>
		g.append(svg('rect', { x: cx - w / 2, y: cy - hh / 2, width: w, height: hh, style: `fill:${fill};stroke:var(--fig-fg);stroke-width:1.3;${extra}` }));
	const lock = (/** @type {SVGElement} */ g, /** @type {number} */ lx, /** @type {number} */ ly) =>
		g.append(svg('rect', { x: lx - 5, y: ly - 3, width: 10, height: 8, style: `fill:${PAL.red};` }), svg('path', { d: `M${lx - 3},${ly - 3} a3,3 0 0 1 6,0`, style: `fill:none;stroke:${PAL.red};stroke-width:1.6;` }));
	/** Text with a subscript, e.g. h₁ with arbitrary sub letters. */
	const sub = (/** @type {SVGElement} */ g, /** @type {[number, number]} */ at, /** @type {string} */ base, /** @type {string} */ s) =>
		g.append(svg('text', { x: at[0], y: at[1], 'text-anchor': 'middle', style: 'font-size:14px;font-style:italic;fill:var(--fig-fg);' }, base, svg('tspan', { dy: 4, style: 'font-size:10px;' }, s)));

	// ---- pre-aggregation box (background) --------------------------------------------------------
	pre.append(svg('rect', { x: X(-1.05), y: Y(2.85), width: X(9.75) - X(-1.05), height: Y(-2.05) - Y(2.85), rx: 10, style: 'fill:color-mix(in oklab, var(--fig-fg) 3%, var(--fig-bg));stroke:var(--fig-muted);stroke-width:1.5;stroke-dasharray:7 5;' }));
	t(pre, [X(9.65), Y(2.62)], L.tb, 'font-size:12.5px;font-style:italic;fill:var(--fig-muted);', 'end');
	t(pre, [X(9.65), Y(-1.9)], L.pre, 'font-size:16px;font-weight:700;fill:var(--fig-muted);', 'end');

	// ---- (a) the warp ----------------------------------------------------------------------------
	const cs = 0.4;
	const wy = (/** @type {number} */ i) => 0.35 + 1.4 - i * (cs + 0.02);
	const groupsOf = [SA, SA, SA, SB, SB, SC, SC, SC];
	for (const [i0, i1, col] of [[0, 2, SA], [3, 4, SB], [5, 7, SC]]) {
		const [hx, hy0] = P(-0.3, wy(Number(i0)) + 0.27);
		const [, hy1] = P(0, wy(Number(i1)) - 0.27);
		pre.append(svg('rect', { x: hx, y: hy0, width: 0.6 * K, height: hy1 - hy0, rx: 6, style: `fill:${tint(String(col), 18)};` }));
	}
	groupsOf.forEach((col, i) => {
		const leader = i === 0 || i === 3 || i === 5;
		const [cx, cy] = P(0, wy(i));
		cell(pre, cx, cy, cs * K, cs * K, leader ? col : tint(col, 32), leader ? 'stroke-width:2.2;' : '');
		if (leader) pre.append(svg('text', { x: cx, y: cy + 6, 'text-anchor': 'middle', style: 'font-size:15px;fill:var(--fig-bg);' }, '★'));
	});
	t(pre, P(0, wy(0) + 0.62), L.warp, 'font-weight:700;');
	t(pre, P(0, wy(0) + 0.36), L.threads32, 'font-size:12px;');
	t(pre, P(0, wy(7) - 0.5), L.subgroup, 'font-size:12px;');
	[[0, SA, '1'], [3, SB, '2'], [5, SC, '3']].forEach(([i, col, n]) => {
		const [nx, ny] = P(-0.42, wy(Number(i)));
		pre.append(svg('circle', { cx: nx, cy: ny, r: 11, style: `fill:${col};` }), svg('text', { x: nx, y: ny + 5, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:700;fill:var(--fig-bg);' }, String(n)));
	});

	// ---- (b) per-warp cache W ----------------------------------------------------------------------
	const rh = 0.49;
	const wCols = [0.6, 0.7, 0.6, 0.45];
	const wx0 = 3.3 - wCols.reduce((a, z) => a + z, 0) / 2;
	const rowY = (/** @type {number} */ r) => 0.4 + 2 * rh - r * rh; // r = 0 header
	const colX = (/** @type {number[]} */ cols, /** @type {number} */ x0, /** @type {number} */ k) => x0 + cols.slice(0, k).reduce((a, z) => a + z, 0) + cols[k] / 2;
	const wRows = [['h', 'key', 'val'], ['h|1', 'k|1', 'v|1'], ['h|a', 'k|a', 'v|a'], ['h|z', 'k|z', 'v|z'], ['h|b', 'k|b', 'v|b']];
	wRows.forEach((row, r) => {
		const [, cy] = P(0, rowY(r));
		wCols.forEach((w, k) => {
			const cx = X(colX(wCols, wx0, k));
			const fill = k === 3 ? tint(PAL.red, r === 0 ? 45 : 20) : r === 0 ? tint(PAL.amber, 60) : r === 1 && k === 0 ? tint(SA, 25) : k === 0 ? tint(PAL.amber, 14) : 'var(--fig-bg)';
			cell(pre, cx, cy, w * K, rh * K, fill);
			if (k === 3) lock(pre, cx, cy + 1);
			else {
				const [base, s] = String(row[k]).split('|');
				if (s) sub(pre, [cx, cy + 4], base, s);
				else t(pre, [cx, cy + 5], base, r === 0 && k === 0 ? 'font-style:italic;' : '');
			}
		});
	});
	t(pre, P(3.3, rowY(0) + 0.72), L.wTitle, 'font-weight:700;font-size:15.5px;');
	t(pre, P(3.3, rowY(0) + 0.45), L.wSub, 'font-size:12px;');
	t(pre, P(3.3, rowY(4) - 0.62), L.wCap, 'font-size:12px;');

	// ---- (c) per-block directory H | L | P ---------------------------------------------------------
	const dCols = [0.65, 0.45, 0.65];
	const dx0 = 8.2 - dCols.reduce((a, z) => a + z, 0) / 2;
	const dRows = [['H', 'L', 'P'], ['h|x'], ['h|2'], ['⊥'], ['h|y']];
	/** @type {[number, number][]} */ const ptr = [];
	dRows.forEach((row, r) => {
		const [, cy] = P(0, rowY(r));
		dCols.forEach((w, k) => {
			const cx = X(colX(dCols, dx0, k));
			const fill = k === 1 ? tint(PAL.red, r === 0 ? 45 : 16) : r === 0 ? tint(PAL.green, 60) : k === 0 && r === 2 ? tint(SB, 25) : k === 0 && r === 3 ? tint(SC, 25) : tint(PAL.green, 16);
			cell(pre, cx, cy, w * K, rh * K, fill);
			if (r === 0) t(pre, [cx, cy + 5], String(row[k]), 'font-style:italic;');
			else if (k === 0) {
				const [base, s] = String(row[0]).split('|');
				if (s) sub(pre, [cx, cy + 4], base, s);
				else t(pre, [cx, cy + 5], base);
			} else if (k === 1) lock(pre, cx, cy + 1);
			else {
				pre.append(svg('circle', { cx, cy, r: 3.5, style: 'fill:var(--fig-fg);' }));
				ptr.push([cx, cy]);
			}
		});
	});
	t(pre, P(8.2, rowY(0) + 0.72), L.dTitle, 'font-weight:700;font-size:15.5px;');
	t(pre, P(8.2, rowY(0) + 0.45), L.dSub, 'font-size:12px;');
	t(pre, P(8.2, rowY(4) - 0.62), L.dCap, 'font-size:12px;');

	// ---- the three scenarios -----------------------------------------------------------------------
	const wLeft = X(wx0);
	const wRight = X(wx0 + 2.35);
	const dLeft = X(dx0);
	const lead = (/** @type {number} */ i) => [X(0.2), Y(wy(i))];
	const rowPx = (/** @type {number} */ r) => Y(rowY(r));
	const scen = svg('g');
	scen.append(arrow(/** @type {[number, number]} */ (lead(0)), [wLeft, rowPx(1)], { c1: [X(1.3), Y(wy(0))], c2: [X(1.6), rowPx(1)], color: SA, width: 3 }));
	t(scen, [wRight + 8, rowPx(1) + 5], L.hit, `font-size:12.5px;font-weight:700;fill:${SA};`, 'start');
	scen.append(arrow(/** @type {[number, number]} */ (lead(3)), [wLeft, rowPx(2)], { c1: [X(1.3), Y(wy(3))], c2: [X(1.6), rowPx(2)], color: SB, width: 3 }));
	for (const d of [-6, 6]) scen.append(arrow([wRight, rowPx(2) + d], [dLeft, rowPx(2) + d * 0.6], { c1: [X(6.3), rowPx(2) + d], c2: [X(6.3), rowPx(2) + d * 0.6], color: SB, width: 1.6 }));
	t(scen, [wRight + 8, rowPx(2) + 22], L.miss, `font-size:12.5px;font-weight:700;fill:${SB};`, 'start');
	scen.append(arrow(/** @type {[number, number]} */ (lead(5)), [wLeft, rowPx(4)], { c1: [X(1.3), Y(wy(5))], c2: [X(1.6), rowPx(4)], color: SC, width: 3 }));
	for (const d of [-9, 0, 9]) scen.append(arrow([wRight, rowPx(4) + d], [dLeft, rowPx(3) + d * 0.6], { c1: [X(6.3), rowPx(4) + d], c2: [X(6.6), rowPx(3) + d * 0.6], color: SC, width: 1.6 }));
	t(scen, [wRight + 8, rowPx(4) + 26], L.miss, `font-size:12.5px;font-weight:700;fill:${SC};`, 'start');
	// Between the warp (u 0.2) and the cache (left edge u ≈ 2.1), level with "all threads (no leader)".
	t(scen, P(1.15, -1.55), L.leader, 'font-size:12px;font-style:italic;fill:var(--fig-muted);');
	t(scen, P(5.9, -1.55), L.all, 'font-size:12px;font-style:italic;fill:var(--fig-muted);');
	pre.append(scen);

	// ---- hand-off: partitions × thread-blocks → merge blocks → hash tables → result ---------------
	const gx = 11.8;
	const gw = 0.9;
	const rows = [['0', 1.5], ['1', 0.6], ['2', -0.3], ['255', -1.6]];
	const Bx = 16.0;
	const Hx = 17.8;
	const Rx = 19.6;
	const [rx, ry] = P(Rx, -0.05);
	merge.append(svg('rect', { x: rx - 0.75 * K, y: ry - 0.85 * K, width: 1.5 * K, height: 1.7 * K, rx: 8, style: `fill:${tint(PAL.green, 35)};stroke:var(--fig-fg);stroke-width:1.5;` }));
	t(merge, [rx, ry - 2], L.result1, 'font-size:13px;font-weight:700;');
	t(merge, [rx, ry + 16], L.result2, 'font-size:13px;font-weight:700;');
	['b₀', 'b₁', 'b₂', '⋯'].forEach((lbl, k) => t(merge, P(gx + k * gw, 2.15), lbl, 'font-size:13px;font-style:italic;'));
	const [bx0, by] = P(gx - 0.55, 2.45);
	const [bx1] = P(gx + 3 * gw + 0.3, 0);
	merge.append(svg('path', { d: `M${bx0},${by + 6} q0,-6 6,-6 H${(bx0 + bx1) / 2 - 6} l6,-6 l6,6 H${bx1 - 6} q6,0 6,6`, style: 'fill:none;stroke:var(--fig-fg);stroke-width:1.4;' }));
	t(merge, [(bx0 + bx1) / 2, by - 26], L.brace1, 'font-size:12px;');
	t(merge, [(bx0 + bx1) / 2, by - 11], L.brace2, 'font-size:12px;');
	for (const [p, v] of rows) {
		const yv = Number(v);
		const [bandX, bandY] = P(gx - 0.6, yv + 0.31);
		merge.append(svg('rect', { x: bandX, y: bandY, width: (3 * gw + 0.95) * K, height: 0.62 * K, rx: 6, style: `fill:${tint(PAL.purple, 14)};` }));
		merge.append(svg('text', { x: X(gx - 0.68), y: Y(yv) + 5, 'text-anchor': 'end', style: 'font-size:13px;font-style:italic;fill:var(--fig-fg);' }, 'P', svg('tspan', { dy: 4, style: 'font-size:9.5px;' }, String(p))));
		for (let k = 0; k < 3; k++) {
			const [cx, cy] = P(gx + k * gw, yv);
			cell(merge, cx, cy, 0.7 * K, 0.46 * K, tint('var(--fig-muted)', 22));
			merge.append(svg('line', { x1: cx, y1: cy - 0.23 * K, x2: cx, y2: cy + 0.23 * K, style: 'stroke:var(--fig-muted);stroke-width:1;' }));
		}
		t(merge, P(gx + 3 * gw, yv - 0.08), '⋯', 'font-size:16px;');
		const [mx, my] = P(Bx, yv);
		merge.append(arrow(P(gx + 3 * gw + 0.35, yv), [mx - 0.48 * K, my], { width: 2.6 }));
		merge.append(svg('rect', { x: mx - 0.45 * K, y: my - 0.3 * K, width: 0.9 * K, height: 0.6 * K, rx: 6, style: `fill:${tint(PAL.purple, 45)};stroke:var(--fig-fg);stroke-width:1.3;` }));
		merge.append(svg('text', { x: mx, y: my + 5, 'text-anchor': 'middle', style: 'font-size:13px;font-style:italic;fill:var(--fig-fg);' }, 'B', svg('tspan', { dy: 4, style: 'font-size:9.5px;' }, String(p))));
		const [hx, hy] = P(Hx, yv);
		merge.append(arrow([mx + 0.45 * K, my], [hx - 0.62 * K, hy], { width: 1.6 }));
		for (let k = 0; k < 5; k++) cell(merge, hx - 0.5 * K + k * 0.2 * K + 0.1 * K, hy, 0.19 * K, 0.19 * K, k === 1 || k === 3 ? tint(PAL.purple, 55) : 'var(--fig-bg)', 'stroke-width:1;');
		merge.append(arrow([hx + 0.55 * K, hy], [rx - 0.78 * K, ry + (yv - (-0.05)) * -0.25 * K], { width: 1.4, color: 'var(--fig-muted)' }));
	}
	for (const u of [gx, gx + gw, gx + 2 * gw, Bx, Hx]) t(merge, P(u, -0.95), '⋮', 'font-size:16px;');
	t(merge, P(Bx, 2.55), L.mBlocks, 'font-weight:700;font-size:15px;');
	t(merge, P(Bx, 2.3), L.mSub, 'font-size:12px;');
	t(merge, P(Hx, 2.62), L.hts1, 'font-weight:700;font-size:15px;');
	t(merge, P(Hx, 2.35), L.hts2, 'font-weight:700;font-size:15px;');
	t(merge, P(Rx + 0.7, -1.9), L.merge, 'font-size:16px;font-weight:700;fill:var(--fig-muted);', 'end');
	// b₀'s entries written through the directory pointers.
	const [e1x, e1y] = P(gx - 0.17, 0.6);
	const [e2x, e2y] = P(gx + 0.17, -1.6);
	merge.append(svg('rect', { x: e1x - 0.155 * K, y: e1y - 0.23 * K, width: 0.31 * K, height: 0.46 * K, style: `fill:${tint(PAL.green, 60)};` }));
	merge.append(svg('rect', { x: e2x - 0.155 * K, y: e2y - 0.23 * K, width: 0.31 * K, height: 0.46 * K, style: `fill:${tint(PAL.green, 25)};stroke:var(--fig-fg);stroke-dasharray:3 2;` }));

	// Directory pointers into b₀'s partitions (they cross from the pre-aggregation box to the grid).
	const links = svg('g');
	links.append(arrow(ptr[1], [X(gx - 0.36), Y(0.6)], { c1: [ptr[1][0] + 140, ptr[1][1]], c2: [X(gx - 1.3), Y(0.6)], color: SB, width: 2.6 }));
	// Starts just right of the pre-aggregation box (right edge u 9.75) and sits above P₁'s band (top v 0.91),
	// so longer de/uk labels run over the gap instead of into the box or the partition grid.
	t(links, [X(9.75) + 8, Y(0.91) - 6], L.hitAgg, `font-size:12.5px;fill:${SB};`, 'start');
	links.append(arrow(ptr[2], [X(gx - 0.36), Y(-1.6)], { c1: [ptr[2][0] + 150, ptr[2][1]], c2: [X(gx - 1.3), Y(-1.6)], color: SC, width: 2.6, dash: '7 4' }));
	t(links, [X(9.95), Y(-1.6) + 30], L.missApp, `font-size:12.5px;fill:${SC};`, 'start');

	c.append(pre, merge, links);
	b.part(pre, (s) => ({ opacity: emph(s) === 'merge' ? 0.3 : 1 }));
	b.part(merge, (s) => ({ opacity: emph(s) === 'pre' ? 0.3 : 1 }));
	b.part(links, (s) => ({ opacity: emph(s) === 'all' ? 1 : 0.55 }));
	root.append(c);
	return c;
}

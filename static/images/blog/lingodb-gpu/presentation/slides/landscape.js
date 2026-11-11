// Slide 3a: a word cloud of GPU database engines (size = citations of the defining paper) that morphs into
// the paper's classification table. Engines in the table fly into their cells, OmniSci and HeavyDB merge
// into MapD, everything else fades out, and the table grid fades in around them.
import { slide, h } from '../lib.js';
import { ENGINES, CLOUD, TIER_PX, TABLE, bodyTop, GROUPS, STYLES, cellPos } from './landscape-data.js';

const T = TABLE;
const right = T.x + 5 * T.colW;
const bottom = bodyTop + T.rows * T.rowH;

export default slide({
	name: 'landscape',
	label: { en: 'Where we started', de: 'Wo wir angefangen haben', uk: 'З чого ми почали' },
	title: { en: 'Where we started', de: 'Wo wir angefangen haben', uk: 'З чого ми почали' },
	states: [
		{ name: 'cloud', label: { en: 'GPU database engines', de: 'GPU-Datenbank-Engines', uk: 'Рушії GPU-баз даних' } },
		{ name: 'table', label: { en: 'Classification', de: 'Einordnung', uk: 'Класифікація' } }
	],
	build(b, root) {
		// Table grid (headers, rules, legend): fades in after the names start moving.
		const grid = h('div', 'position:absolute;inset:0;pointer-events:none;');
		const line = (/** @type {string} */ css) => grid.append(h('div', `position:absolute;${css}`));
		line(`left:${T.x}px;width:${right - T.x}px;top:${T.top + T.h1}px;border-top:1px solid var(--fig-muted);`);
		line(`left:${T.x}px;width:${right - T.x}px;top:${bodyTop}px;border-top:3px solid var(--fig-fg);`);
		line(`left:${T.x}px;width:${right - T.x}px;top:${bottom}px;border-top:2px solid var(--fig-fg);`);
		for (let r = 1; r < T.rows; r++) line(`left:${T.x}px;width:${right - T.x}px;top:${bodyTop + r * T.rowH}px;border-top:1px solid var(--fig-dim);`);
		for (const c of [2, 3]) line(`left:${T.x + c * T.colW}px;top:${T.top}px;height:${bottom - T.top}px;border-left:2px solid var(--fig-muted);`);
		for (const c of [1, 4]) line(`left:${T.x + c * T.colW}px;top:${T.top + T.h1}px;height:${bottom - T.top - T.h1}px;border-left:1px dashed var(--fig-dim);`);
		for (const [label, c, span] of GROUPS) {
			grid.append(b.text('div', `position:absolute;left:${T.x + Number(c) * T.colW}px;width:${Number(span) * T.colW}px;top:${T.top}px;height:${T.h1}px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.05;font-size:${Number(span) > 1 ? 27 : 21}px;font-weight:700;`, /** @type {any} */ (label)));
		}
		STYLES.forEach((st, c) => {
			grid.append(b.text('div', `position:absolute;left:${T.x + c * T.colW + 10}px;width:${T.colW - 20}px;top:${T.top + T.h1}px;height:${T.h2}px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:20px;line-height:1.2;color:var(--fig-fg);`, st));
		});
		// "+" between r3d3 and rNdN in the first cell.
		grid.append(h('div', `position:absolute;left:${T.x + 14 + 66}px;top:${bodyTop}px;height:${T.rowH}px;display:flex;align-items:center;font-size:${T.font}px;`, '+'));
		grid.append(b.text('div', `position:absolute;left:${T.x}px;top:${bottom + 18}px;font-size:22px;color:var(--fig-fg);`, { en: '**⇄** = supports co-processing', de: '**⇄** = unterstützt Co-Processing', uk: '**⇄** = підтримує спільну обробку CPU/GPU' }));
		b.show(grid, 1, Infinity, { delay: (f, t) => (t > f ? 650 : 0), duration: 500 });
		root.append(grid);

		// Cloud caption.
		const cap = b.text('div', 'position:absolute;left:80px;right:80px;top:828px;font-size:21px;color:var(--fig-fg);', {
			en: 'Engine names sized by citations',
			de: 'Engine-Namen nach Zitationen skaliert',
			uk: 'Розмір назв рушіїв — за кількістю цитувань'
		});
		b.show(cap, 0, 1);
		root.append(cap);

		// The names. Each is anchored at its left-centre so the table cells line up without measuring.
		ENGINES.forEach((e, i) => {
			const c = CLOUD[i];
			const target = cellPos(e);
			const big = TIER_PX[e.tier] >= TIER_PX.L;
			const word = h('div', `position:absolute;left:0;top:0;height:0;display:flex;align-items:center;white-space:nowrap;transform-origin:0 0;font-size:${T.font}px;line-height:1;font-weight:${big ? 700 : 500};`);
			word.append(h('span', '', e.name));
			if (e.co) {
				const co = h('span', 'margin-left:0.3em;color:var(--fig-accent);font-weight:700;', '⇄');
				word.append(co);
				b.part(co, (s) => ({ opacity: s >= 1 ? 1 : 0 }), { delay: (f, t) => (t > f ? 1000 : 0), duration: 400 });
			}
			const cloud = { translateX: c.x, translateY: c.y, rotate: c.rot, scale: c.scale, opacity: 1 };
			if (target) {
				const end = { translateX: target.x, translateY: target.y, rotate: 0, scale: 1, opacity: e.merge ? 0 : 1 };
				b.part(word, (s) => (s >= 1 ? end : cloud), {
					delay: (f, t) => (t > f ? 150 + (i % 14) * 28 : 80 + (i % 14) * 18),
					duration: 1100,
					ease: 'inOutQuart'
				});
			} else {
				b.part(word, (s) => (s >= 1 ? { ...cloud, opacity: 0, scale: c.scale * 0.85 } : cloud), {
					delay: (f, t) => (t > f ? (i % 9) * 25 : 450 + (i % 9) * 25),
					duration: 450,
					ease: 'outQuad'
				});
			}
			root.append(word);
		});
	}
});

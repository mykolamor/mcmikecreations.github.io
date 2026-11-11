// Slide 4a: what the paper is (and isn't) about. The in-scope column first, then the orthogonal topics,
// then a note on compilation.
import { slide, h } from '../lib.js';

const ROWS = [
	[{ en: 'In-memory analytics: SSB, TPC-H, TPC-DS', de: 'In-Memory-Analytics: SSB, TPC-H, TPC-DS', uk: 'Аналітика в пам’яті: SSB, TPC-H, TPC-DS' },
		{ en: 'Data transfers', de: 'Datentransfers', uk: 'Передачі даних' }],
	[{ en: 'Data already on a single-node GPU', de: 'Daten liegen schon auf der GPU eines einzelnen Knotens', uk: 'Дані вже на GPU одного вузла' },
		{ en: 'Multi-GPU and co-processing', de: 'Multi-GPU und Co-Processing', uk: 'Кілька GPU і спільна обробка CPU/GPU' }],
	[{ en: 'Competitive compilation', de: 'Konkurrenzfähige Kompilierung', uk: 'Конкурентна компіляція' },
		{ en: 'OLTP and streaming', de: 'OLTP und Streaming', uk: 'OLTP і потокова обробка' }]
];

export default slide({
	name: 'scope',
	label: { en: 'Scope', de: 'Umfang', uk: 'Межі роботи' },
	title: { en: 'Scope', de: 'Umfang', uk: 'Межі роботи' },
	states: [
		{ name: 'in', label: { en: 'In scope', de: 'Im Fokus', uk: 'У межах' } },
		{ name: 'out', label: { en: 'Out of scope', de: 'Außerhalb', uk: 'Поза межами' } },
		{ name: 'compile', label: { en: 'Compilation', de: 'Kompilierung', uk: 'Компіляція' } }
	],
	build(b, root) {
		const grid = h('div', 'position:absolute;left:80px;right:80px;top:150px;display:grid;grid-template-columns:1fr 1fr;column-gap:40px;font-size:23px;line-height:1.22;');
		// The out-of-scope column (header + cells) slides in as one block: same motion, same delay, no stagger.
		const outBlock = (/** @type {HTMLElement} */ el) =>
			b.part(el, (s) => ({ opacity: s >= 1 ? 1 : 0, translateX: s >= 1 ? 0 : 40 }), { delay: (f, t) => (t > f ? 150 : 0) });
		const head = (/** @type {string} */ c, /** @type {any} */ loc, /** @type {number} */ at) => {
			const el = b.text('div', `font-size:28px;font-weight:800;color:${c};padding:0 0 10px;border-bottom:3px solid ${c};`, loc);
			if (at === 1) outBlock(el);
			else b.show(el, at);
			grid.append(el);
		};
		head('var(--fig-accent)', { en: 'In scope', de: 'Im Fokus', uk: 'У межах роботи' }, 0);
		head('var(--fig-fg)', { en: 'Out of scope (orthogonal)', de: 'Außerhalb (orthogonal)', uk: 'Поза межами (ортогональне)' }, 1);
		for (const [inn, out] of ROWS) {
			const a = b.text('div', 'padding:10px 0;border-bottom:1px solid var(--fig-dim);', inn);
			const z = b.text('div', 'padding:10px 0;border-bottom:1px solid var(--fig-dim);color:var(--fig-fg);', out);
			b.show(a, 0);
			outBlock(z);
			grid.append(a, z);
		}
		root.append(grid);

		const notes = h('div', 'position:absolute;left:80px;right:80px;top:676px;font-size:22px;line-height:1.28;');
		const note = (/** @type {any} */ head2, /** @type {any} */ body, /** @type {number} */ at) => {
			const n = h('div', 'border-left:6px solid var(--fig-accent2);padding:4px 0 4px 20px;');
			n.append(b.text('div', 'font-weight:700;margin-bottom:6px;', head2), b.text('div', 'white-space:pre-line;', body));
			b.show(n, at);
			notes.append(n);
		};
		note({ en: 'Compilation is practical, not a focus', de: 'Kompilierung ist praxistauglich, aber kein Schwerpunkt', uk: 'Компіляція практична, але не в центрі уваги' },
			{ en: 'TPC-H pipelines compile in 69 ms (Q6) to 490 ms (Q2), in parallel per pipeline.\ncuDF’s `compute_column_jit` takes ~110 ms for `a*(1-b)`.',
				de: 'TPC-H-Pipelines kompilieren in 69 ms (Q6) bis 490 ms (Q2), parallel pro Pipeline.\n`compute_column_jit` von cuDF braucht ~110 ms für `a*(1-b)`.',
				uk: 'Конвеєри TPC-H компілюються за 69 мс (Q6)–490 мс (Q2), паралельно для кожного конвеєра.\n`compute_column_jit` у cuDF потребує ~110 мс для `a*(1-b)`.' }, 2);
		root.append(notes);
	}
});

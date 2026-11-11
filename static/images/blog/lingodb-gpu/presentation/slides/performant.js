// Slide 10: TPC-H SF 10 on the RTX 5090, every system's time relative to LingoDB/GPU (Fig. 9: bars up =
// LingoDB faster, signed log scale), with the slowdown ranges, the Q1 exception, then the Nsight phase
// breakdown (Fig. 10, converted from PDF).
import { slide, h, bullets, barChart, FILL, num, same } from '../lib.js';
import { phases } from '../figs/phases.js';
import { DATA } from '../data.js';

const R = DATA.tpchRtx5090Sf10;
const SERIES = [
	{ label: same('HeavyDB'), fill: FILL.heavydb, v: R.HeavyDB },
	{ label: same('Sirius'), fill: FILL.sirius, v: R.Sirius, fallback: new Set(R.siriusCpuFallback) },
	{ label: same('GQE'), fill: FILL.gqe, v: R.GQE },
	{ label: same('PystachIO'), fill: FILL.pystachio, v: R.PystachIO }
];

export default slide({
	name: 'performant',
	label: { en: 'Performant: TPC-H', de: 'Performant: TPC-H', uk: 'Продуктивність: TPC-H' },
	title: { en: 'Performant: TPC-H and where the time goes', de: 'Performant: TPC-H und wohin die Zeit geht', uk: 'Продуктивність: TPC-H і куди йде час' },
	states: [
		{ name: 'chart', label: { en: 'Relative slowdown and ranges', de: 'Relative Verlangsamung und Spannweiten', uk: 'Відносне сповільнення й діапазони' } },
		{ name: 'q1', label: { en: 'The Q1 exception', de: 'Die Ausnahme Q1', uk: 'Виняток Q1' } },
		{ name: 'breakdown', label: { en: 'Where the time goes', de: 'Wohin die Zeit geht', uk: 'Куди йде час' } }
	],
	build(b, root) {
		const cap = b.text('div', 'position:absolute;left:170px;top:140px;font-size:24px;font-weight:700;', {
			en: 'TPC-H SF 10, RTX 5090: slowdown relative to LingoDB/GPU (bars up: LingoDB is faster)',
			de: 'TPC-H SF 10, RTX 5090: Verlangsamung relativ zu LingoDB/GPU (Balken nach oben: LingoDB ist schneller)',
			uk: 'TPC-H SF 10, RTX 5090: сповільнення відносно LingoDB/GPU (стовпці вгору: LingoDB швидша)'
		});
		b.show(cap, 0, 2);
		root.append(cap);
		barChart(b, root, {
			box: { x: 170, y: 200, w: 1370, h: 390 },
			groups: Array.from({ length: 22 }, (_, i) => String(i + 1)),
			series: SERIES.map((se) => ({
				label: se.label,
				fill: se.fill,
				value: (_s, g) => se.v[g],
				mark: se.fallback ? (g) => se.fallback.has(g + 1) : undefined
			})),
			scale: 'log',
			domain: [0.4, 200],
			base: 1,
			ticks: [0.5, 1, 2, 5, 10, 20, 50, 100, 200],
			tickFmt: (v) => num(v, undefined, '×'),
			visible: (s) => s < 2,
			dimGroup: (s, g) => s === 1 && g !== 0,
			missing: '×',
			legend: { x: 170, y: 640 },
			groupSize: 20
		});
		const lnote = b.text('div', 'position:absolute;left:820px;top:644px;font-size:19px;color:var(--fig-fg);', {
			en: '○ Sirius fell back to the CPU · × did not run',
			de: '○ Sirius ist auf die CPU ausgewichen · × lief nicht',
			uk: '○ Sirius перейшов на CPU · × не виконався'
		});
		b.show(lnote, 0, 2);
		root.append(lnote);

		const ranges = h('div', 'position:absolute;left:170px;right:80px;top:700px;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;font-size:23px;line-height:1.28;');
		const rng = (/** @type {string} */ who, /** @type {any} */ text) => {
			const c = h('div', 'border-top:4px solid var(--fig-accent);padding-top:8px;');
			c.append(b.text('div', 'font-weight:700;', same(who)), b.text('div', '', text));
			ranges.append(c);
		};
		rng('HeavyDB', { en: '1.8–165× (except Q1)', de: '1,8–165× (außer Q1)', uk: '1,8–165× (крім Q1)' });
		rng('Sirius', { en: '1.84–11.1× (up to 38× when it falls back to CPU)', de: '1,84–11,1× (bis 38×, wenn es auf die CPU ausweicht)', uk: '1,84–11,1× (до 38×, коли переходить на CPU)' });
		rng('GQE', { en: '1.93–16.2×', de: '1,93–16,2×', uk: '1,93–16,2×' });
		rng('PystachIO', { en: '4.25–96.5×', de: '4,25–96,5×', uk: '4,25–96,5×' });
		b.show(ranges, 0, 1);
		root.append(ranges);
		const only = b.text('div', 'position:absolute;left:170px;top:850px;font-size:24px;font-weight:600;', {
			en: 'Only LingoDB runs all 22 queries on the GPU.',
			de: 'Nur LingoDB führt alle 22 Anfragen auf der GPU aus.',
			uk: 'Лише LingoDB виконує всі 22 запити на GPU.'
		});
		b.show(only, 0, 1);
		root.append(only);

		const q1 = b.text('div', 'position:absolute;left:170px;right:80px;top:705px;font-size:30px;line-height:1.35;', {
			en: '**Q1 is the exception:** HeavyDB is 2× faster because it uses 64-bit decimals, whereas LingoDB does contended 128-bit sums over 4–6 groups.',
			de: '**Q1 ist die Ausnahme:** HeavyDB ist 2× schneller, weil es 64-Bit-Dezimalzahlen nutzt, während LingoDB umkämpfte 128-Bit-Summen über 4–6 Gruppen bildet.',
			uk: '**Q1 — виняток:** HeavyDB удвічі швидша, бо використовує 64-бітні десяткові, тоді як LingoDB рахує 128-бітні суми з конкуренцією за 4–6 груп.'
		});
		b.show(q1, 1, 2);
		root.append(q1);

		phases(b, root, 80, 140, (s) => s === 2);
		const bd = h('div', 'position:absolute;left:80px;right:80px;top:545px;');
		bd.append(bullets(b, [
			{ at: 2, text: {
				en: '**cuDF-based systems:** compute alone takes 1.7–10× (GQE) and 2.2–8.3× (Sirius) longer: every operator round-trips global memory. GQE spends up to 48% of its time materializing',
				de: '**cuDF-basierte Systeme:** allein die Berechnung dauert 1,7–10× (GQE) und 2,2–8,3× (Sirius) länger: jeder Operator geht über den globalen Speicher. GQE verbringt bis zu 48 % der Zeit mit Materialisierung',
				uk: '**Системи на cuDF:** лише обчислення триває в 1,7–10× (GQE) і 2,2–8,3× (Sirius) довше: кожен оператор ходить через глобальну пам’ять. GQE витрачає до 48 % часу на матеріалізацію' } },
			{ at: 2, text: {
				en: '**HeavyDB** uses the GPU as an accelerator: it merges on the CPU and re-columnarizes between steps (85% of Q18’s 433 ms)',
				de: '**HeavyDB** nutzt die GPU als Beschleuniger: es führt auf der CPU zusammen und wandelt zwischen den Schritten wieder in Spalten um (85 % der 433 ms von Q18)',
				uk: '**HeavyDB** використовує GPU як прискорювач: зливає на CPU й знову перетворює дані на стовпці між кроками (85 % із 433 мс у Q18)' } },
			{ at: 2, text: {
				en: '**Remaining gap to prototypes:** a fixed setup cost of 0.2–1.5 ms per query, which matters only on ~1–3 ms SSB queries',
				de: '**Verbleibende Lücke zu Prototypen:** feste Setup-Kosten von 0,2–1,5 ms pro Anfrage, die nur bei SSB-Anfragen von ~1–3 ms ins Gewicht fallen',
				uk: '**Решта розриву з прототипами:** фіксовані витрати на підготовку 0,2–1,5 мс на запит, які важать лише для SSB-запитів тривалістю ~1–3 мс' } }
		], { size: 25, gap: 12 }));
		root.append(bd);
	}
});

// Slide 11: the three non-RTX platforms with their geomean GPU-over-CPU speedup (TPC-H SF 50), then the
// per-query speedups as a signed log chart (Fig. 11 and Table 6 of the paper), then the hardware quirks.
import { slide, h, bullets, table, barChart, FILL, num, same } from '../lib.js';
import { DATA } from '../data.js';

const G = DATA.gpuOverCpuSf50;
const SERIES = [
	{ label: { en: 'Nvidia GH200 (geomean 5.2×)', de: 'Nvidia GH200 (geom. Mittel 5,2×)', uk: 'Nvidia GH200 (геом. середнє 5,2×)' }, fill: FILL.lingoGpu, v: G.GH200 },
	{ label: { en: 'AMD MI300A (9.4×)', de: 'AMD MI300A (9,4×)', uk: 'AMD MI300A (9,4×)' }, fill: FILL.crystal, v: G.MI300A },
	{ label: { en: 'Apple M3 Ultra (5.1×)', de: 'Apple M3 Ultra (5,1×)', uk: 'Apple M3 Ultra (5,1×)' }, fill: 'var(--fig-fg)', v: G['M3 Ultra'] }
];

export default slide({
	name: 'portable',
	label: { en: 'Portable: Nvidia, AMD, Apple', de: 'Portabel: Nvidia, AMD, Apple', uk: 'Переносимість: Nvidia, AMD, Apple' },
	title: { en: 'Portable: Nvidia, AMD, and Apple', de: 'Portabel: Nvidia, AMD und Apple', uk: 'Переносимість: Nvidia, AMD і Apple' },
	states: [
		{ name: 'platforms', label: { en: 'Platforms', de: 'Plattformen', uk: 'Платформи' } },
		{ name: 'per-query', label: { en: 'Per-query speedup', de: 'Speedup pro Anfrage', uk: 'Прискорення за запитами' } },
		{ name: 'quirks', label: { en: 'Hardware quirks', de: 'Hardware-Eigenheiten', uk: 'Апаратні особливості' } }
	],
	build(b, root) {
		const top = h('div', 'position:absolute;left:180px;right:180px;top:180px;');
		top.append(table(b, [
			[{ en: 'Platform', de: 'Plattform', uk: 'Платформа' }, { en: 'Type', de: 'Typ', uk: 'Тип' }, { en: 'GPU vs. LingoDB CPU', de: 'GPU vs. LingoDB-CPU', uk: 'GPU порівняно з CPU LingoDB' }],
			[same('Nvidia GH200'), { en: 'Data center, NVLink superchip', de: 'Rechenzentrum, NVLink-Superchip', uk: 'Центр обробки даних, суперчип NVLink' }, { en: '**5.2×**', de: '**5,2×**', uk: '**5,2×**' }],
			[same('AMD MI300A'), { en: 'Data center APU, unified memory, 6 chiplets', de: 'Rechenzentrums-APU, Unified Memory, 6 Chiplets', uk: 'APU для ЦОД, уніфікована пам’ять, 6 чиплетів' }, { en: '**9.4×**', de: '**9,4×**', uk: '**9,4×**' }],
			[same('Apple M3 Ultra'), { en: 'Workstation SoC, unified memory', de: 'Workstation-SoC, Unified Memory', uk: 'SoC для робочих станцій, уніфікована пам’ять' }, { en: '**5.1×**', de: '**5,1×**', uk: '**5,1×**' }]
		], { size: 31 }));
		top.append(b.text('div', 'margin-top:14px;font-size:22px;color:var(--fig-fg);', { en: 'Geometric mean over TPC-H, SF 50', de: 'Geometrisches Mittel über TPC-H, SF 50', uk: 'Геометричне середнє за TPC-H, SF 50' }));
		top.append(b.text('div', 'margin-top:46px;font-size:31px;line-height:1.35;', {
			en: 'All 22 TPC-H queries run end to end on every platform, and LingoDB’s CPU engine already beats HyPer and DuckDB.',
			de: 'Alle 22 TPC-H-Anfragen laufen auf jeder Plattform vollständig durch, und die CPU-Engine von LingoDB schlägt bereits HyPer und DuckDB.',
			uk: 'Усі 22 запити TPC-H повністю виконуються на кожній платформі, а CPU-рушій LingoDB уже обганяє HyPer і DuckDB.'
		}));
		b.show(top, 0, 1);
		root.append(top);

		const cap = b.text('div', 'position:absolute;left:170px;top:140px;font-size:24px;font-weight:700;', {
			en: 'TPC-H SF 50: LingoDB/GPU speedup over LingoDB/CPU on the same machine',
			de: 'TPC-H SF 50: Speedup von LingoDB/GPU gegenüber LingoDB/CPU auf derselben Maschine',
			uk: 'TPC-H SF 50: прискорення LingoDB/GPU відносно LingoDB/CPU на тій самій машині'
		});
		b.show(cap, 1);
		root.append(cap);
		barChart(b, root, {
			box: { x: 170, y: 200, w: 1370, h: 360 },
			groups: Array.from({ length: 22 }, (_, i) => String(i + 1)),
			series: SERIES.map((se) => ({ label: se.label, fill: se.fill, value: (_s, g) => se.v[g] })),
			scale: 'log',
			domain: [0.5, 200],
			base: 1,
			ticks: [0.5, 1, 2, 5, 10, 20, 50, 100, 200],
			tickFmt: (v) => num(v, undefined, '×'),
			visible: (s) => s >= 1,
			legend: { x: 170, y: 610 },
			groupSize: 20
		});
		const out = b.text('div', 'position:absolute;left:170px;right:80px;top:660px;font-size:22px;color:var(--fig-fg);', {
			en: 'Slower than the CPU: Q1 on GH200 (0.74×) and M3 Ultra (0.9×), Q18 on MI300A (0.8×)',
			de: 'Langsamer als die CPU: Q1 auf GH200 (0,74×) und M3 Ultra (0,9×), Q18 auf MI300A (0,8×)',
			uk: 'Повільніше за CPU: Q1 на GH200 (0,74×) і M3 Ultra (0,9×), Q18 на MI300A (0,8×)'
		});
		b.show(out, 1);
		root.append(out);

		const q = h('div', 'position:absolute;left:170px;right:80px;top:712px;');
		q.append(bullets(b, [
			{ at: 2, text: {
				en: '**MI300A:** cross-chiplet atomics are very expensive, so the global-hashtable GroupJoin is disabled (Q3: 86 ms → 24 ms), matching the local-vs-global micro-benchmark',
				de: '**MI300A:** Atomics zwischen Chiplets sind sehr teuer, also ist der GroupJoin mit globaler Hashtabelle deaktiviert (Q3: 86 ms → 24 ms), passend zum Lokal-vs.-Global-Microbenchmark',
				uk: '**MI300A:** атомарні операції між чиплетами дуже дорогі, тож GroupJoin із глобальною хеш-таблицею вимкнено (Q3: 86 мс → 24 мс), що збігається з мікробенчмарком «локальний проти глобального»' } },
			{ at: 2, text: {
				en: '**M3 Ultra:** no 64-bit atomics and no 128-bit integers, so both are emulated; Q1 is the weakest query',
				de: '**M3 Ultra:** keine 64-Bit-Atomics und keine 128-Bit-Integer, also werden beide emuliert; Q1 ist die schwächste Anfrage',
				uk: '**M3 Ultra:** немає 64-бітних атомарних операцій і 128-бітних цілих, тож обидва емулюються; Q1 — найслабший запит' } }
		], { size: 23, gap: 8 }));
		root.append(q);
	}
});

// Slide 3: the taxonomy (two axes), the paper's micro-benchmark (Fig. 2a/2b: speedup and global memory
// traffic reduction vs. operator-at-a-time, TPC-H SF 5, fully materializing variants), then the takeaways.
// The chart's bars tween between the two metrics.
import { slide, h, bullets, barChart, FILL, num } from '../lib.js';

// figures/benchmarks/data-microbenchmarks/results_q*_sf5.csv, computed as in plot_microbench_combined.py
// (baseline / model for wall_time_ms and dram_mb).
const QUERIES = ['Q1', 'Q3', 'Q6', 'Q9', 'Q18'];
const SPEEDUP = {
	op: [1, 1, 1, 1, 1],
	tile: [3.286, 1.65, 1.709, 1.113, 1.1],
	tuple: [3.237, 1.752, 4.754, 1.005, 1.058]
};
const TRAFFIC = {
	op: [1, 1, 1, 1, 1],
	tile: [5.126, 1.481, 1.445, 0.928, 1.064],
	tuple: [5.131, 1.754, 4.566, 0.918, 1.025]
};
const metric = (/** @type {number} */ s) => (s === 2 ? TRAFFIC : SPEEDUP);

export default slide({
	name: 'models',
	label: { en: 'Which execution model?', de: 'Welches Ausführungsmodell?', uk: 'Яка модель виконання?' },
	title: { en: 'Which execution model? 190 papers, one winner', de: 'Welches Ausführungsmodell? 190 Paper, ein Gewinner', uk: 'Яка модель виконання? 190 статей, один переможець' },
	states: [
		{ name: 'axes', label: { en: 'Taxonomy', de: 'Taxonomie', uk: 'Таксономія' } },
		{ name: 'speedup', label: { en: 'Speedup', de: 'Speedup', uk: 'Прискорення' } },
		{ name: 'traffic', label: { en: 'Memory traffic', de: 'Speicherverkehr', uk: 'Трафік пам’яті' } },
		{ name: 'takeaways', label: { en: 'Takeaways', de: 'Erkenntnisse', uk: 'Висновки' } }
	],
	build(b, root) {
		const left = h('div', 'position:absolute;left:80px;top:170px;width:600px;');
		left.append(bullets(b, [
			{ at: 0, until: 3, text: { en: '**Data granularity**', de: '**Datengranularität**', uk: '**Гранулярність даних**' },
				sub: [{ en: 'column/batch-at-a-time', de: 'Spalte/Batch auf einmal', uk: 'стовпець/пакет за раз' }, { en: 'tile-at-a-time', de: 'Kachel für Kachel', uk: 'плитка за плиткою' }, { en: 'tuple-at-a-time', de: 'Tupel für Tupel', uk: 'кортеж за кортежем' }] },
			{ at: 0, until: 1, text: { en: '**Execution granularity**', de: '**Ausführungsgranularität**', uk: '**Гранулярність виконання**' },
				sub: [{ en: 'kernel per operator', de: 'ein Kernel pro Operator', uk: 'ядро на кожен оператор' }, { en: 'fused pipeline kernels', de: 'fusionierte Pipeline-Kernel', uk: 'злиті ядра конвеєрів' }] }
		], { size: 32 }));
		b.show(left, 0, 3);
		root.append(left);

		const take = h('div', 'position:absolute;left:80px;top:170px;width:640px;');
		take.append(b.text('div', 'font-size:30px;color:var(--fig-fg);margin-bottom:22px;', { en: 'Takeaways:', de: 'Erkenntnisse:', uk: 'Висновки:' }));
		take.append(bullets(b, [
			{ at: 3, text: { en: '**(Relaxed) fusion** is consistently better', de: '**(Gelockerte) Fusion** ist durchweg besser', uk: '**(Послаблене) злиття** стабільно краще' } },
			{ at: 3, text: { en: '**Tuple-at-a-time** is the most robust choice', de: '**Tupel für Tupel** ist die robusteste Wahl', uk: '**Кортеж за кортежем** — найнадійніший вибір' } },
			{ at: 3, text: { en: 'Tuple-at-a-time gets **late materialization “for free”**: the compiler defers the loads', de: 'Tupel für Tupel bekommt **späte Materialisierung „gratis“**: der Compiler verzögert die Ladezugriffe', uk: 'Кортеж за кортежем отримує **пізню матеріалізацію «безкоштовно»**: компілятор відкладає завантаження' } }
		], { size: 32, gap: 30 }));
		b.show(take, 3);
		root.append(take);

		const caption = (/** @type {number} */ s0, /** @type {number} */ s1, /** @type {any} */ loc) => {
			const c = b.text('div', 'position:absolute;left:770px;top:160px;width:770px;font-size:26px;line-height:1.15;font-weight:700;', loc);
			b.part(c, (s) => ({ opacity: s === s0 || (s1 && s >= s1) ? 1 : 0 }), { duration: 350 });
			root.append(c);
		};
		caption(1, 3, { en: 'End-to-end speedup vs. operator-at-a-time', de: 'End-to-End-Speedup gegenüber Operator für Operator', uk: 'Наскрізне прискорення порівняно з «по одному оператору»' });
		caption(2, 0, { en: 'Global memory traffic reduction vs. operator-at-a-time', de: 'Weniger globaler Speicherverkehr als bei Operator für Operator', uk: 'Зменшення трафіку глобальної пам’яті порівняно з «по одному оператору»' });
		const sub = b.text('div', 'position:absolute;left:770px;top:226px;width:770px;font-size:20px;color:var(--fig-fg);', {
			en: 'TPC-H SF 5, hand-written kernels, same data structures, fully materializing',
			de: 'TPC-H SF 5, handgeschriebene Kernel, gleiche Datenstrukturen, voll materialisierend',
			uk: 'TPC-H SF 5, написані вручну ядра, однакові структури даних, повна матеріалізація'
		});
		b.part(sub, (s) => ({ opacity: s >= 1 ? 1 : 0 }));
		root.append(sub);

		const series = [
			{ key: 'op', label: { en: 'Op-at-a-time', de: 'Operator für Operator', uk: 'По одному оператору' }, fill: FILL.op },
			{ key: 'tile', label: { en: 'Tile-at-a-time', de: 'Kachel für Kachel', uk: 'Плитка за плиткою' }, fill: FILL.tile },
			{ key: 'tuple', label: { en: 'Tuple-at-a-time', de: 'Tupel für Tupel', uk: 'Кортеж за кортежем' }, fill: FILL.lingoGpu }
		];
		barChart(b, root, {
			box: { x: 840, y: 280, w: 700, h: 420 },
			groups: QUERIES,
			series: series.map((se) => ({
				label: se.label,
				fill: se.fill,
				value: (s, g) => metric(s)[/** @type {'op'|'tile'|'tuple'} */ (se.key)][g]
			})),
			scale: 'linear',
			domain: [0, 5.6],
			base: 0,
			ticks: [0, 1, 2, 3, 4, 5],
			tickFmt: (v) => num(v, 0, '×'),
			visible: (s) => s >= 1,
			labels: (s, g, i) => (i === 0 || s < 1 ? null : metric(s)[i === 1 ? 'tile' : 'tuple'][g]),
			legend: { x: 840, y: 760 },
			labelSize: 15,
			groupSize: 24
		});
	}
});

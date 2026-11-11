// Slide 9: benchmark coverage (paper Table 2), then SSB-simplified SF 10 on the RTX 5090 (Fig. 8) as a
// log-scale bar chart together with the takeaway. Data: figures/benchmarks/data-rtx5090/*/ssbSimplifiedSf10*.csv,
// loaded the way plot_rtx5090_ssb.py does (LingoDB, Crystal and Themis split kernel / total time).
import { slide, h, table, barChart, FILL, num, same } from '../lib.js';

const Q = ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '3.4', '4.1', '4.2', '4.3'];
const SYSTEMS = [
	{ label: same('LingoDB/GPU'), fill: FILL.lingoGpu,
		total: [0.913, 0.748, 0.732, 1.851, 1.524, 1.252, 1.963, 1.668, 1.253, 1.17, 2.193, 3.277, 1.919],
		kernel: [0.711, 0.573, 0.567, 1.432, 1.088, 0.874, 1.491, 1.215, 0.824, 0.726, 1.729, 2.802, 1.415] },
	{ label: same('Crystal-Opt'), fill: FILL.crystal,
		total: [0.2692, 0.1752, 0.1624, 0.5898, 0.5859, 0.5909, 1.773, 1.103, 1.0696, 1.0647, 0.9223, 0.8162, 2.3693],
		kernel: [0.260672, 0.165792, 0.151936, 0.5744, 0.559648, 0.565856, 1.35235, 0.657536, 0.608384, 0.605664, 0.883008, 0.785408, 0.730624] },
	{ label: same('Themis'), fill: FILL.themis,
		total: [1.605, 0.503, 0.479, 0.857, 0.754, 0.731, 1.011, 0.596, 0.534, 0.528, 1.039, 0.927, 0.813],
		kernel: [1.595, 0.493, 0.469, 0.837, 0.734, 0.71, 0.986, 0.569, 0.51, 0.503, 1.018, 0.901, 0.786] },
	{ label: same('HeavyDB'), fill: FILL.heavydb, total: [6, 6, 5, 7, 7, 7, 7, 7, 7, 7, 9, 8, 16], kernel: null },
	{ label: same('Sirius'), fill: FILL.sirius, total: [2, 1, 1, 9, 11, 7, 15, 9, 9, 7, 14, 15, 10], kernel: null }
];

export default slide({
	name: 'practical',
	label: { en: 'Practical: coverage and SSB', de: 'Praxistauglich: Abdeckung und SSB', uk: 'Практичність: покриття та SSB' },
	title: { en: 'Practical: full coverage, prototype-level speed on SSB', de: 'Praxistauglich: volle Abdeckung, Prototyp-Tempo bei SSB', uk: 'Практичність: повне покриття, швидкість прототипів на SSB' },
	states: [
		{ name: 'coverage', label: { en: 'Benchmark coverage', de: 'Benchmark-Abdeckung', uk: 'Покриття бенчмарків' } },
		{ name: 'ssb', label: { en: 'SSB-simplified and takeaway', de: 'SSB-simplified und Fazit', uk: 'SSB-simplified і висновок' } }
	],
	build(b, root) {
		const cov = h('div', 'position:absolute;left:180px;right:180px;top:170px;');
		cov.append(b.text('div', 'font-size:28px;font-weight:700;margin-bottom:12px;', { en: 'Benchmark coverage (# of queries that run)', de: 'Benchmark-Abdeckung (Anzahl lauffähiger Anfragen)', uk: 'Покриття бенчмарків (кількість запитів, що виконуються)' }));
		const D = same('–');
		cov.append(table(b, [
			[{ en: 'System', de: 'System', uk: 'Система' }, same('TPC-H (22)'), same('TPC-DS (99)'), same('SSB (13)'), same('SSB-simpl. (13)')],
			[same('**LingoDB/GPU**'), same('**22**'), same('**99**'), same('**13**'), same('**13**')],
			[same('HeavyDB'), same('22'), same('52'), same('13'), same('13')],
			[same('GQE'), same('21'), same('42'), same('13'), same('13')],
			[same('Sirius'), same('17'), same('25'), same('10'), same('13')],
			[{ en: '*PystachIO (prototype)*', de: '*PystachIO (Prototyp)*', uk: '*PystachIO (прототип)*' }, same('20'), D, D, D],
			[{ en: '*Themis (prototype)*', de: '*Themis (Prototyp)*', uk: '*Themis (прототип)*' }, D, D, D, same('13')],
			[{ en: '*Crystal-Opt (prototype)*', de: '*Crystal-Opt (Prototyp)*', uk: '*Crystal-Opt (прототип)*' }, D, D, D, same('13')]
		], { size: 28 }));
		b.show(cov, 0, 1);
		root.append(cov);

		const cap = b.text('div', 'position:absolute;left:180px;top:150px;font-size:26px;font-weight:700;', {
			en: 'SSB-simplified, SF 10, RTX 5090: execution time [ms], log scale (lower is faster)',
			de: 'SSB-simplified, SF 10, RTX 5090: Ausführungszeit [ms], log. Skala (niedriger ist schneller)',
			uk: 'SSB-simplified, SF 10, RTX 5090: час виконання [мс], логарифмічна шкала (менше — швидше)'
		});
		b.show(cap, 1);
		root.append(cap);
		barChart(b, root, {
			box: { x: 180, y: 215, w: 1360, h: 430 },
			groups: Q,
			series: SYSTEMS.map((se) => ({
				label: se.label,
				fill: se.fill,
				value: (_s, g) => se.total[g],
				inner: se.kernel ? (g) => /** @type {number[]} */ (se.kernel)[g] : undefined
			})),
			scale: 'log',
			domain: [0.1, 20],
			base: 0.1,
			ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20],
			tickFmt: (v) => num(v),
			axisLabel: { en: 'ms', de: 'ms', uk: 'мс' },
			axisPad: 70,
			visible: (s) => s >= 1,
			legend: { x: 180, y: 700 },
			groupSize: 22
		});
		const note = b.text('div', 'position:absolute;left:1000px;top:704px;font-size:19px;color:var(--fig-fg);', {
			en: 'Shaded lower part: GPU kernel time',
			de: 'Schattierter unterer Teil: GPU-Kernelzeit',
			uk: 'Затінена нижня частина: час ядра GPU'
		});
		b.show(note, 1);
		root.append(note);

		const take = b.text('div', 'position:absolute;left:180px;right:80px;top:770px;font-size:26px;line-height:1.35;', {
			en: 'LingoDB is close to the hand-tuned Crystal-Opt and Themis (typically within ~2×) and beats them on Q1.1 and Q4.3. Full systems lag far behind: **HeavyDB averages 7.62 ms, Sirius 8.46 ms**, more than 3× slower.',
			de: 'LingoDB liegt nah an den handoptimierten Crystal-Opt und Themis (meist innerhalb von ~2×) und schlägt sie bei Q1.1 und Q4.3. Vollständige Systeme liegen weit zurück: **HeavyDB im Schnitt 7,62 ms, Sirius 8,46 ms**, mehr als 3× langsamer.',
			uk: 'LingoDB близька до вручну налаштованих Crystal-Opt і Themis (зазвичай у межах ~2×) і обганяє їх на Q1.1 та Q4.3. Повноцінні системи сильно відстають: **HeavyDB у середньому 7,62 мс, Sirius 8,46 мс**, понад утричі повільніше.'
		});
		b.show(take, 1);
		root.append(take);
	}
});

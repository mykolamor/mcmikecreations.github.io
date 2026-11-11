// Slide 6: proxy-locks in shared memory, their effect on Q18's merge (paper Table 4), and why local state
// is portable (Fig. 5: speedup of block-local over global aggregation state, TPC-H SF 10).
import { slide, h, bullets, table, barChart, num, same } from '../lib.js';

// figures/benchmarks/data-microbenchmarks/results_local_vs_global_sf10.csv: global / local-block time_ms.
const GPUS = [
	{ label: same('RTX 5090'), fill: 'var(--fig-accent)', v: [15.28, 1.31] },
	{ label: same('MI210'), fill: 'var(--fig-accent2)', v: [31.25, 1.2] },
	{ label: same('MI300A'), fill: 'var(--fig-fg)', v: [787.34, 2.1] }
];

export default slide({
	name: 'sync',
	label: { en: 'Cheap synchronization', de: 'Günstige Synchronisation', uk: 'Дешева синхронізація' },
	title: { en: 'Cheap synchronization and portability come with local state', de: 'Günstige Synchronisation und Portabilität kommen mit lokalem Zustand', uk: 'Дешева синхронізація й переносимість приходять із локальним станом' },
	states: [
		{ name: 'locks', label: { en: 'Proxy-locks', de: 'Proxy-Locks', uk: 'Проксі-блокування' } },
		{ name: 'q18', label: { en: 'Q18 merge and local vs. global state', de: 'Q18-Merge und lokaler vs. globaler Zustand', uk: 'Злиття в Q18 і локальний vs. глобальний стан' } }
	],
	build(b, root) {
		const left = h('div', 'position:absolute;left:80px;top:170px;width:800px;');
		left.append(bullets(b, [
			{ at: 0, text: { en: '**Proxy-locks in shared memory:** state is block-local, so its locks can live in SMEM', de: '**Proxy-Locks im Shared Memory:** der Zustand ist Block-lokal, also können seine Locks im SMEM liegen', uk: '**Проксі-блокування в спільній пам’яті:** стан локальний для блоку, тож його блокування можуть жити в SMEM' },
				sub: [
					{ en: 'A fixed-size array of (1-bit) locks indexed by hash, set and released with atomic OR/AND', de: 'Ein Array fester Größe aus (1-Bit-)Locks, per Hash indiziert, gesetzt und gelöst mit atomarem OR/AND', uk: 'Масив фіксованого розміру з (1-бітних) блокувань, індексований хешем, що ставляться й знімаються атомарними OR/AND' },
					{ en: 'Up to two orders of magnitude cheaper than locks in global memory', de: 'Bis zu zwei Größenordnungen günstiger als Locks im globalen Speicher', uk: 'До двох порядків дешевші за блокування в глобальній пам’яті' }
				] }
		], { size: 29 }));
		root.append(left);

		const tq = h('div', 'position:absolute;left:80px;top:480px;width:820px;');
		tq.append(b.text('div', 'font-size:25px;font-weight:700;margin-bottom:8px;', { en: 'Q18’s aggregation merge (RTX 5090)', de: 'Aggregations-Merge von Q18 (RTX 5090)', uk: 'Злиття агрегації в Q18 (RTX 5090)' }));
		tq.append(table(b, [
			[{ en: 'Approach', de: 'Ansatz', uk: 'Підхід' }, { en: 'L2 atomics [M]', de: 'L2-Atomics [Mio.]', uk: 'Атомарні L2 [млн]' }, { en: 'Kernel [ms]', de: 'Kernel [ms]', uk: 'Ядро [мс]' }, { en: 'Q18 total [ms]', de: 'Q18 gesamt [ms]', uk: 'Q18 загалом [мс]' }],
			[{ en: 'SMEM proxy-locks', de: 'SMEM-Proxy-Locks', uk: 'Проксі-блокування в SMEM' }, ...[5.31, 6.28, 13.04].map((v) => (/** @type {string} */ l) => `**${num(v, 2)(l)}**`)],
			[{ en: 'Per-entry lock, block scope', de: 'Lock pro Eintrag, Block-Scope', uk: 'Блокування на запис, область блоку' }, num(33.86, 2), num(15.57, 2), num(22.28, 2)]
		], { size: 23 }));
		b.show(tq, 1);
		root.append(tq);

		const port = b.text('div', 'position:absolute;left:80px;top:760px;width:820px;font-size:25px;line-height:1.3;', {
			en: '**Portability:** under contention, the penalty for global state varies dramatically across architectures; local state stays predictable.',
			de: '**Portabilität:** unter Contention schwankt der Preis für globalen Zustand enorm zwischen Architekturen; lokaler Zustand bleibt vorhersehbar.',
			uk: '**Переносимість:** під конкуренцією штраф за глобальний стан різко відрізняється між архітектурами; локальний стан лишається передбачуваним.'
		});
		b.show(port, 1);
		root.append(port);

		const cap = b.text('div', 'position:absolute;left:960px;top:160px;width:580px;font-size:23px;line-height:1.2;font-weight:700;', {
			en: 'Speedup of block-local over global aggregation state (TPC-H SF 10)',
			de: 'Speedup von Block-lokalem gegenüber globalem Aggregationszustand (TPC-H SF 10)',
			uk: 'Прискорення локального для блоку стану агрегації порівняно з глобальним (TPC-H SF 10)'
		});
		b.show(cap, 1);
		root.append(cap);
		barChart(b, root, {
			box: { x: 1050, y: 270, w: 470, h: 440 },
			groups: ['Q1', 'Q18'],
			series: GPUS.map((g) => ({ label: g.label, fill: g.fill, value: (_s, gi) => g.v[gi] })),
			scale: 'log',
			domain: [1, 1500],
			base: 1,
			ticks: [1, 10, 100, 1000],
			tickFmt: (v) => num(v, 0, '×'),
			visible: (s) => s >= 1,
			labels: (s, g, i) => (s >= 1 ? GPUS[i].v[g] : null),
			legend: { x: 1050, y: 770 },
			groupSize: 26
		});
	}
});

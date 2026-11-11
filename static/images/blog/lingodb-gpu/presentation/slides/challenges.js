// Slide 4: the four challenges that prototypes sidestep (F1+F2, then R1+P1), then the evidence for R1/P1:
// the paper's synchronization micro-benchmark (Fig. 3, converted from PDF) next to its cache table (Table 1).
import { slide, h, figure, table, same } from '../lib.js';

const ROWS = [
	['F1', { en: 'Unknown cardinalities', de: 'Unbekannte Kardinalitäten', uk: 'Невідомі кардинальності' },
		{ en: 'No materialization → mid-pipeline sizes are unknown',
			de: 'Keine Materialisierung → Größen mitten in der Pipeline sind unbekannt',
			uk: 'Без матеріалізації → розміри всередині конвеєра невідомі' }],
	['F2', { en: 'Unknown data distributions', de: 'Unbekannte Datenverteilungen', uk: 'Невідомі розподіли даних' },
		{ en: 'cuDF restarts when a size limit is hit, HeavyDB overallocates or crashes,\nPyTorch spills to CPU RAM and disk',
			de: 'cuDF startet neu, wenn eine Größengrenze erreicht ist, HeavyDB reserviert zu viel Speicher oder stürzt ab,\nPyTorch lagert in CPU-RAM und auf die Festplatte aus',
			uk: 'cuDF перезапускається, коли досягнуто ліміту розміру, HeavyDB виділяє забагато пам’яті або аварійно завершується,\nPyTorch вивантажує дані в RAM CPU і на диск' }],
	['R1', { en: 'Real types need real synchronization', de: 'Echte Typen brauchen echte Synchronisation', uk: 'Справжні типи потребують справжньої синхронізації' },
		{ en: '128-bit decimals and strings have no native atomics.\nLocks cost about 0.5–1 order of magnitude more than atomics',
			de: '128-Bit-Dezimalzahlen und Strings haben keine nativen Atomics.\nLocks kosten etwa 0,5–1 Größenordnung mehr als Atomics',
			uk: '128-бітні десяткові числа та рядки не мають нативних атомарних операцій.\nБлокування дорожчі за атомарні операції на 0,5–1 порядок' }],
	['P1', { en: 'Performance portability', de: 'Performance-Portabilität', uk: 'Переносимість продуктивності' },
		{ en: 'Cache sizes and latencies, warp lockstep, missing 64-bit atomics (Apple), expensive cross-chiplet atomics (MI300A)',
			de: 'Cache-Größen und -Latenzen, Warp-Lockstep, fehlende 64-Bit-Atomics (Apple), teure Atomics zwischen Chiplets (MI300A)',
			uk: 'Розміри й затримки кешів, синхронне виконання warp, відсутні 64-бітні атомарні операції (Apple), дорогі атомарні операції між чиплетами (MI300A)' }]
];

// Table 1 of the paper (main.tex, tab:gpu-cache).
const CACHES = [
	[{ en: 'GPU', de: 'GPU', uk: 'GPU' }, { en: 'L1 + shared', de: 'L1 + Shared', uk: 'L1 + спільна' }, same('L2'), same('L3')],
	[same('RTX 5090'), { en: '128 KiB/SM, ≤100 KiB sh.', de: '128 KiB/SM, ≤100 KiB sh.', uk: '128 КіБ/SM, ≤100 КіБ сп.' }, { en: '96 MiB/GPU, ~130 ns†', de: '96 MiB/GPU, ~130 ns†', uk: '96 МіБ/GPU, ~130 нс†' }, same('—')],
	[same('GH200'), { en: '256 KiB/SM, ≤228 KiB sh.', de: '256 KiB/SM, ≤228 KiB sh.', uk: '256 КіБ/SM, ≤228 КіБ сп.' }, { en: '50 MiB/GPU, ~141 ns*', de: '50 MiB/GPU, ~141 ns*', uk: '50 МіБ/GPU, ~141 нс*' }, same('—')],
	[same('MI210'), { en: '16 + 64 KiB/CU', de: '16 + 64 KiB/CU', uk: '16 + 64 КіБ/CU' }, { en: '8 MiB/GPU, 170 ns', de: '8 MiB/GPU, 170 ns', uk: '8 МіБ/GPU, 170 нс' }, same('—')],
	[same('MI300A'), { en: '32 + 64 KiB/CU', de: '32 + 64 KiB/CU', uk: '32 + 64 КіБ/CU' }, { en: '4 MiB/XCD, 100–108 ns', de: '4 MiB/XCD, 100–108 ns', uk: '4 МіБ/XCD, 100–108 нс' }, { en: '256 MiB, 205–218 ns', de: '256 MiB, 205–218 ns', uk: '256 МіБ, 205–218 нс' }]
];

export default slide({
	name: 'challenges',
	label: { en: 'Four challenges', de: 'Vier Herausforderungen', uk: 'Чотири виклики' },
	title: { en: 'Why don’t prototypes translate into systems?', de: 'Warum werden aus Prototypen keine Systeme?', uk: 'Чому прототипи не стають системами?' },
	states: [
		{ name: 'flexibility', label: { en: 'F1, F2: unknown sizes and distributions', de: 'F1, F2: unbekannte Größen und Verteilungen', uk: 'F1, F2: невідомі розміри й розподіли' } },
		{ name: 'robustness', label: { en: 'R1, P1: synchronization and portability', de: 'R1, P1: Synchronisation und Portabilität', uk: 'R1, P1: синхронізація та переносимість' } },
		{ name: 'evidence', label: { en: 'Synchronization cost and caches', de: 'Synchronisationskosten und Caches', uk: 'Вартість синхронізації та кеші' } }
	],
	build(b, root) {
		const list = h('div', 'position:absolute;left:80px;right:80px;top:160px;display:flex;flex-direction:column;');
		ROWS.forEach(([code, name, why], i) => {
			const row = h('div', 'display:grid;grid-template-columns:100px 430px 1fr;gap:26px;align-items:start;padding:20px 0;border-bottom:1px solid var(--fig-dim);');
			row.append(
				h('div', `font-size:40px;font-weight:800;color:${i < 2 ? 'var(--fig-accent)' : i === 2 ? 'var(--fig-accent2)' : 'var(--fig-fg)'};`, String(code)),
				b.text('div', 'font-size:31px;font-weight:700;line-height:1.2;', /** @type {any} */ (name)),
				b.text('div', 'font-size:24px;line-height:1.28;color:var(--fig-fg);white-space:pre-line;', /** @type {any} */ (why))
			);
			const at = i < 2 ? 0 : 1; // F1+F2 together, then R1+P1 together
			b.part(row, (s) => ({ opacity: s >= at && s < 2 ? 1 : 0, translateY: s >= at ? 0 : 24 }));
			list.append(row);
		});
		const foot = b.text('div', 'margin-top:22px;font-size:23px;color:var(--fig-fg);', {
			en: 'Prototypes sidestep these: SSB-simplified uses only ints and floats; hash functions and data-structure sizes are tuned per query.',
			de: 'Prototypen umgehen das: SSB-simplified nutzt nur Ints und Floats; Hashfunktionen und Größen der Datenstrukturen sind pro Anfrage abgestimmt.',
			uk: 'Прототипи це обходять: SSB-simplified використовує лише цілі та дробові числа; хеш-функції й розміри структур даних налаштовані під кожен запит.'
		});
		b.show(foot, 1, 2);
		list.append(foot);
		root.append(list);

		const fig = figure(b, new URL('../figures/random_k64_all_gpus.svg', import.meta.url), 'left:80px;top:160px;width:860px;height:470px;', {
			en: 'Relative throughput of global atomicAdd, global spinlock and shared-memory spinlock versus contention on RTX 5090, MI210, MI300A and M3 Ultra',
			de: 'Relativer Durchsatz von globalem atomicAdd, globalem Spinlock und Spinlock im Shared Memory abhängig von der Contention auf RTX 5090, MI210, MI300A und M3 Ultra',
			uk: 'Відносна пропускна здатність глобального atomicAdd, глобального спінлока та спінлока в спільній пам’яті залежно від конкуренції на RTX 5090, MI210, MI300A і M3 Ultra'
		});
		b.show(fig, 2);
		root.append(fig);
		const figCap = b.text('div', 'position:absolute;left:80px;top:650px;width:860px;font-size:22px;line-height:1.3;color:var(--fig-fg);', {
			en: 'Synchronization cost: throughput relative to a shared-memory baseline vs. contention (threads per value). A lock is ~0.5 (no contention) to ~1 (contention) order of magnitude slower than an atomic.',
			de: 'Synchronisationskosten: Durchsatz relativ zu einer Shared-Memory-Basislinie über der Contention (Threads pro Wert). Ein Lock ist ~0,5 (ohne Contention) bis ~1 (mit Contention) Größenordnung langsamer als ein Atomic.',
			uk: 'Вартість синхронізації: пропускна здатність відносно базової лінії в спільній пам’яті залежно від конкуренції (потоків на значення). Блокування повільніше за атомарну операцію на ~0,5 (без конкуренції) – ~1 (з конкуренцією) порядок.'
		});
		b.show(figCap, 2);
		root.append(figCap);

		const caches = h('div', 'position:absolute;left:980px;right:80px;top:170px;');
		caches.append(b.text('div', 'font-size:26px;font-weight:700;margin-bottom:10px;', { en: 'Cache hierarchy and latency', de: 'Cache-Hierarchie und Latenz', uk: 'Ієрархія кешів і затримки' }));
		caches.append(table(b, CACHES, { size: 19 }));
		caches.append(b.text('div', 'margin-top:12px;font-size:16px;line-height:1.3;color:var(--fig-fg);', {
			en: 'XCD: GPU compute die; AMD L1 = vector cache. MI300A L2 total: 24 MiB. *GH200 estimated from H100. †RTX 5090 measured on the RTX PRO 6000 (same GB202 die).',
			de: 'XCD: GPU-Compute-Die; AMD-L1 = Vektor-Cache. MI300A-L2 gesamt: 24 MiB. *GH200 aus H100-Messungen geschätzt. †RTX 5090 auf der RTX PRO 6000 gemessen (gleicher GB202-Die).',
			uk: 'XCD: обчислювальний кристал GPU; L1 у AMD = векторний кеш. L2 MI300A загалом: 24 МіБ. *GH200 оцінено за вимірюваннями H100. †RTX 5090 виміряно на RTX PRO 6000 (той самий кристал GB202).'
		}));
		b.part(caches, (s) => ({ opacity: s >= 2 ? 1 : 0, translateX: s >= 2 ? 0 : 40 }));
		root.append(caches);
	}
});

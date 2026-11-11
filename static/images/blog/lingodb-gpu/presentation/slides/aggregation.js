// Slide 7: the robust grouped aggregation. The paper's design figure (Fig. 6, converted from PDF) stays on
// top; the panel below swaps per state: the problem, phase 1, phase 2, and the other operators.
import { slide, h, bullets } from '../lib.js';
import { aggregationDesign } from '../figs/aggregation.js';

export default slide({
	name: 'aggregation',
	label: { en: 'Robust grouped aggregation', de: 'Robuste gruppierte Aggregation', uk: 'Надійна групова агрегація' },
	title: { en: 'A robust grouped aggregation for any distribution', de: 'Eine robuste gruppierte Aggregation für jede Verteilung', uk: 'Надійна групова агрегація для будь-якого розподілу' },
	states: [
		{ name: 'problem', label: { en: 'The problem', de: 'Das Problem', uk: 'Проблема' } },
		{ name: 'phase1', label: { en: 'Phase 1: pre-aggregation', de: 'Phase 1: Vor-Aggregation', uk: 'Фаза 1: попередня агрегація' } },
		{ name: 'phase2', label: { en: 'Phase 2: merge', de: 'Phase 2: Merge', uk: 'Фаза 2: злиття' } },
		{ name: 'others', label: { en: 'Other operators', de: 'Andere Operatoren', uk: 'Інші оператори' } }
	],
	build(b, root) {
		aggregationDesign(b, root, 80, 150, (s) => (s === 1 ? 'pre' : s === 2 ? 'merge' : 'all'));
		const panel = (/** @type {number} */ at, /** @type {any} */ head, /** @type {HTMLElement} */ body) => {
			const p = h('div', 'position:absolute;left:80px;right:80px;top:562px;');
			p.append(b.text('div', 'font-size:29px;font-weight:800;color:var(--fig-accent);margin-bottom:12px;', head), body);
			b.show(p, at, at + 1);
			root.append(p);
		};
		panel(0, { en: 'The problem', de: 'Das Problem', uk: 'Проблема' }, b.text('div', 'font-size:31px;line-height:1.35;white-space:pre-line;', {
			en: 'One implementation should cover a few (TPC-H Q1) to millions of groups\nwith general types (128-bit decimals, strings).',
			de: 'Eine Implementierung soll wenige (TPC-H Q1) bis Millionen Gruppen\nmit allgemeinen Typen (128-Bit-Dezimalzahlen, Strings) abdecken.',
			uk: 'Одна реалізація має покривати від кількох (TPC-H Q1) до мільйонів груп\nіз загальними типами (128-бітні десяткові, рядки).'
		}));
		panel(1, { en: 'Phase 1: block-local pre-aggregation', de: 'Phase 1: Block-lokale Vor-Aggregation', uk: 'Фаза 1: попередня агрегація, локальна для блоку' }, bullets(b, [
			{ at: 1, until: 2, text: {
				en: '**Warp-level direct-mapped cache** (K slots, no eviction): same-hash lanes elect a leader with warp primitives; absorbs very few groups at low contention',
				de: '**Direkt abgebildeter Cache pro Warp** (K Slots, keine Verdrängung): Lanes mit gleichem Hash wählen per Warp-Primitiven einen Leader; fängt sehr wenige Gruppen bei geringer Contention ab',
				uk: '**Кеш прямого відображення на рівні warp** (K слотів, без витіснення): потоки з однаковим хешем обирають лідера через примітиви warp; поглинає дуже мало груп за низької конкуренції' } },
			{ at: 1, until: 2, text: {
				en: '**Block-level directory** (D slots, hash + pointer): lock-free key compare (keys are immutable once published), update under an SMEM proxy-lock, publish new entries via atomic exchange',
				de: '**Verzeichnis auf Block-Ebene** (D Slots, Hash + Zeiger): Schlüsselvergleich ohne Lock (Schlüssel sind nach Veröffentlichung unveränderlich), Update unter einem SMEM-Proxy-Lock, neue Einträge per atomarem Exchange veröffentlichen',
				uk: '**Каталог рівня блоку** (D слотів, хеш + вказівник): порівняння ключів без блокувань (опубліковані ключі незмінні), оновлення під проксі-блокуванням у SMEM, нові записи публікуються атомарним обміном' } },
			{ at: 1, until: 2, text: {
				en: 'Partial aggregates are written **radix-partitioned**: 32 physical × 8 logical partitions, to limit TLB pressure',
				de: 'Teilaggregate werden **Radix-partitioniert** geschrieben: 32 physische × 8 logische Partitionen, um den TLB zu schonen',
				uk: 'Часткові агрегати записуються **з радикс-розбиттям**: 32 фізичні × 8 логічних розділів, щоб обмежити тиск на TLB' } }
		], { size: 23, gap: 8 }));
		panel(2, { en: 'Phase 2: merge', de: 'Phase 2: Merge', uk: 'Фаза 2: злиття' }, b.text('div', 'font-size:31px;line-height:1.35;', {
			en: 'Each of the **256 logical partitions** is merged by exactly one thread-block, with proxy-locks in shared memory: **no inter-block synchronization**.',
			de: 'Jede der **256 logischen Partitionen** wird von genau einem Thread-Block zusammengeführt, mit Proxy-Locks im Shared Memory: **keine Synchronisation zwischen Blöcken**.',
			uk: 'Кожен із **256 логічних розділів** зливає рівно один блок потоків із проксі-блокуваннями в спільній пам’яті: **жодної синхронізації між блоками**.'
		}));
		panel(3, { en: 'Other operators follow the same principles', de: 'Andere Operatoren folgen denselben Prinzipien', uk: 'Інші оператори дотримуються тих самих принципів' }, bullets(b, [
			{ at: 3, text: { en: '**Hash join:** non-partitioned, triangular-quadratic probing, optional bloom filter', de: '**Hash-Join:** nicht partitioniert, dreieckig-quadratisches Sondieren, optionaler Bloom-Filter', uk: '**Хеш-з’єднання:** без розбиття, трикутно-квадратичне зондування, необов’язковий фільтр Блума' } },
			{ at: 3, text: { en: '**Sort:** comparison-based with a JIT-compiled comparator and corank merging', de: '**Sortierung:** vergleichsbasiert mit JIT-kompiliertem Komparator und Corank-Merging', uk: '**Сортування:** на порівняннях, з JIT-компільованим компаратором і злиттям за корангом (corank)' } },
			{ at: 3, text: { en: '**TopK:** streaming, one heap per thread-block', de: '**TopK:** Streaming, ein Heap pro Thread-Block', uk: '**TopK:** потоковий, одна купа на блок потоків' } }
		], { size: 26, gap: 10 }));
	}
});

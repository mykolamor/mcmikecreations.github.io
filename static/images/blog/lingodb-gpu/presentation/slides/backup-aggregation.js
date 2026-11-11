// Backup A: the aggregation micro-benchmark against cuDF/Sirius, with the paper's figure (aggregation_2x2,
// converted from PDF) on the left and the honest trade-offs on the right.
import { slide, h, bullets } from '../lib.js';
import { agg2x2 } from '../figs/agg2x2.js';

export default slide({
	name: 'backup-aggregation',
	label: { en: 'Backup: aggregation micro-benchmark', de: 'Backup: Aggregations-Microbenchmark', uk: 'Резерв: мікробенчмарк агрегації' },
	title: { en: 'Backup: aggregation micro-benchmark (honest trade-offs)', de: 'Backup: Aggregations-Microbenchmark (ehrliche Kompromisse)', uk: 'Резерв: мікробенчмарк агрегації (чесні компроміси)' },
	states: [
		{ name: 'setup', label: { en: 'Setup', de: 'Aufbau', uk: 'Постановка' } },
		{ name: 'unfiltered', label: { en: 'Unfiltered', de: 'Ungefiltert', uk: 'Без фільтра' } },
		{ name: 'filtered', label: { en: 'Filtered', de: 'Gefiltert', uk: 'З фільтром' } },
		{ name: 'argument', label: { en: 'The argument', de: 'Das Argument', uk: 'Аргумент' } }
	],
	build(b, root) {
		agg2x2(b, root, 70, 140, (s, row) => (row === 0 ? s >= 1 : s >= 2));
		const right = h('div', 'position:absolute;left:830px;right:70px;top:160px;');
		right.append(bullets(b, [
			{ at: 0, text: { en: '**Setup:** vs. cuDF/Sirius, 2⁰ to 2²⁶ groups', de: '**Aufbau:** gegen cuDF/Sirius, 2⁰ bis 2²⁶ Gruppen', uk: '**Постановка:** проти cuDF/Sirius, від 2⁰ до 2²⁶ груп' },
				sub: [
					{ en: 'int key + decimal aggregates, int key + string min, string key + string min', de: 'Int-Schlüssel + Dezimal-Aggregate, Int-Schlüssel + String-Min, String-Schlüssel + String-Min', uk: 'цілий ключ + десяткові агрегати, цілий ключ + min рядка, рядковий ключ + min рядка' },
					{ en: 'Data in runs vs. random order; standalone vs. filtered', de: 'Daten in Läufen vs. zufällige Reihenfolge; allein vs. gefiltert', uk: 'Дані серіями чи у випадковому порядку; окремо чи з фільтром' }
				] },
			{ at: 1, text: { en: '**Unfiltered:** no clear winner', de: '**Ungefiltert:** kein klarer Gewinner', uk: '**Без фільтра:** явного переможця немає' },
				sub: [
					{ en: 'We win at few groups with locality and at very many groups (radix partitioning is cache-friendly)', de: 'Wir gewinnen bei wenigen Gruppen mit Lokalität und bei sehr vielen Gruppen (Radix-Partitionierung ist cachefreundlich)', uk: 'Ми виграємо за малої кількості груп із локальністю та за дуже великої (радикс-розбиття дружнє до кешу)' },
					{ en: 'We lose at medium-to-high group counts in random order, where pre-aggregation thrashes', de: 'Wir verlieren bei mittleren bis hohen Gruppenzahlen in zufälliger Reihenfolge, wo die Vor-Aggregation thrasht', uk: 'Ми програємо за середньої та високої кількості груп у випадковому порядку, де попередня агрегація пробуксовує' },
					{ en: 'cuDF’s sort-based path is strong for few groups in sorted runs', de: 'Der sortierbasierte Pfad von cuDF ist stark bei wenigen Gruppen in sortierten Läufen', uk: 'Шлях cuDF через сортування сильний за малої кількості груп у відсортованих серіях' }
				] },
			{ at: 2, text: { en: '**Filtered** (inside a real pipeline): fusion lets LingoDB/GPU win by a wide margin', de: '**Gefiltert** (in einer echten Pipeline): dank Fusion gewinnt LingoDB/GPU deutlich', uk: '**З фільтром** (у справжньому конвеєрі): завдяки злиттю LingoDB/GPU виграє з великим відривом' } },
			{ at: 3, text: { en: 'Robustness (no group-count knowledge, any type) matters more than winning every isolated point', de: 'Robustheit (keine Kenntnis der Gruppenzahl, jeder Typ) zählt mehr, als jeden einzelnen Punkt zu gewinnen', uk: 'Надійність (без знання кількості груп, будь-який тип) важливіша за перемогу в кожній окремій точці' } }
		], { size: 25, subSize: 20, gap: 14 }));
		root.append(right);
	}
});

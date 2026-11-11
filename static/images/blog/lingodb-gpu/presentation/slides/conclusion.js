// Slide 12: conclusion, one point per state.
import { slide, h, bullets } from '../lib.js';

export default slide({
	name: 'conclusion',
	label: { en: 'Conclusion', de: 'Fazit', uk: 'Висновки' },
	title: { en: 'Conclusion', de: 'Fazit', uk: 'Висновки' },
	states: [
		{ name: 'gap', label: { en: 'The gap is real', de: 'Die Lücke ist real', uk: 'Розрив реальний' } },
		{ name: 'principle', label: { en: 'One principle', de: 'Ein Prinzip', uk: 'Один принцип' } },
		{ name: 'system', label: { en: 'In a real system', de: 'In einem echten System', uk: 'У справжній системі' } },
		{ name: 'open', label: { en: 'Open source', de: 'Open Source', uk: 'Відкритий код' } }
	],
	build(b, root) {
		const wrap = h('div', 'position:absolute;left:80px;right:80px;top:170px;');
		wrap.append(bullets(b, [
			{ at: 0, text: {
				en: '**The gap is real:** fused execution wins, but prototypes sidestep unknown cardinalities and distributions, real types, and portability',
				de: '**Die Lücke ist real:** fusionierte Ausführung gewinnt, aber Prototypen umgehen unbekannte Kardinalitäten und Verteilungen, echte Typen und Portabilität',
				uk: '**Розрив реальний:** злите виконання виграє, але прототипи обходять невідомі кардинальності й розподіли, справжні типи та переносимість' } },
			{ at: 1, text: { en: '**One principle closes it:** local, dynamically growing operator state, merged on the GPU', de: '**Ein Prinzip schließt sie:** lokaler, dynamisch wachsender Operatorzustand, auf der GPU zusammengeführt', uk: '**Один принцип його долає:** локальний стан операторів, що росте динамічно й зливається на GPU' },
				sub: [
					{ en: 'No cardinality estimates, cheap SMEM synchronization, predictable performance across vendors', de: 'Keine Kardinalitätsschätzungen, günstige SMEM-Synchronisation, vorhersehbare Performance über Hersteller hinweg', uk: 'Без оцінок кардинальності, дешева синхронізація в SMEM, передбачувана продуктивність у різних виробників' },
					{ en: 'A robust, type-generic grouped aggregation', de: 'Eine robuste, typgenerische gruppierte Aggregation', uk: 'Надійна групова агрегація для будь-яких типів' }
				] },
			{ at: 2, text: {
				en: '**In a real system:** LingoDB/GPU runs all of TPC-H and TPC-DS, is 2–10× faster than state-of-the-art systems, competitive with hand-tuned prototypes, and runs on Nvidia, AMD and Apple',
				de: '**In einem echten System:** LingoDB/GPU führt ganz TPC-H und TPC-DS aus, ist 2–10× schneller als aktuelle Systeme, hält mit handoptimierten Prototypen mit und läuft auf Nvidia, AMD und Apple',
				uk: '**У справжній системі:** LingoDB/GPU виконує весь TPC-H і TPC-DS, у 2–10× швидша за сучасні системи, конкурує з вручну налаштованими прототипами й працює на Nvidia, AMD та Apple' } }
		], { size: 33, gap: 32 }));
		root.append(wrap);
		const link = b.text('div', 'position:absolute;left:80px;right:80px;top:790px;font-size:30px;color:var(--fig-fg);', {
			en: 'Open source; artifacts: **github.com/mykolamor/VLDB-2027-Artifacts**',
			de: 'Open Source; Artefakte: **github.com/mykolamor/VLDB-2027-Artifacts**',
			uk: 'Відкритий код; артефакти: **github.com/mykolamor/VLDB-2027-Artifacts**'
		});
		b.show(link, 3);
		root.append(link);
	}
});

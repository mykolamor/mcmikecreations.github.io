// Slide 8: the implementation in LingoDB, next to the paper's lowering figure (Fig. 7, converted from PDF).
import { slide, h, bullets } from '../lib.js';
import { lowering } from '../figs/lowering.js';

export default slide({
	name: 'lingodb',
	label: { en: 'Implementation in LingoDB', de: 'Implementierung in LingoDB', uk: 'Реалізація в LingoDB' },
	title: { en: 'Implementation in LingoDB', de: 'Implementierung in LingoDB', uk: 'Реалізація в LingoDB' },
	states: [
		{ name: 'lowering', label: { en: 'Lowering', de: 'Lowering', uk: 'Пониження' } },
		{ name: 'subops', label: { en: 'Sub-operators', de: 'Sub-Operatoren', uk: 'Підоператори' } },
		{ name: 'resources', label: { en: 'Kernel resources', de: 'Kernel-Ressourcen', uk: 'Ресурси ядер' } }
	],
	build(b, root) {
		const left = h('div', 'position:absolute;left:80px;top:160px;width:830px;');
		left.append(bullets(b, [
			{ at: 0, text: { en: '**LingoDB:** open-source, MLIR-based compiling DBMS', de: '**LingoDB:** quelloffenes, kompilierendes DBMS auf Basis von MLIR', uk: '**LingoDB:** відкрита компілювальна СКБД на основі MLIR' },
				sub: [
					{ en: 'SQL → `relalg` → **sub-operators** → imperative dialects → LLVM → GPU ISA', de: 'SQL → `relalg` → **Sub-Operatoren** → imperative Dialekte → LLVM → GPU-ISA', uk: 'SQL → `relalg` → **підоператори** → імперативні діалекти → LLVM → ISA GPU' },
					{ en: 'MLIR’s `gpu` dialect targets NVVM, ROCDL and SPIR-V + hand-written Metal', de: 'Der `gpu`-Dialekt von MLIR erzeugt NVVM, ROCDL und SPIR-V + handgeschriebenes Metal', uk: 'Діалект `gpu` у MLIR генерує NVVM, ROCDL і SPIR-V + написаний вручну Metal' }
				] },
			{ at: 1, text: { en: '**Sub-operators decouple the system from device code**', de: '**Sub-Operatoren entkoppeln das System vom Gerätecode**', uk: '**Підоператори відокремлюють систему від коду пристрою**' },
				sub: [
					{ en: 'Parsing, optimization and operator semantics are reused unchanged', de: 'Parsing, Optimierung und Operatorsemantik werden unverändert wiederverwendet', uk: 'Парсинг, оптимізація та семантика операторів використовуються без змін' },
					{ en: 'Only sub-operators that touch data structures get GPU (and vendor-specific) versions', de: 'Nur Sub-Operatoren, die Datenstrukturen anfassen, bekommen GPU- (und herstellerspezifische) Varianten', uk: 'Лише підоператори, що працюють зі структурами даних, мають версії для GPU (і для конкретних виробників)' },
					{ en: 'Strict lockstep on AMD and Apple', de: 'Strikter Lockstep bei AMD und Apple', uk: 'Суворе синхронне виконання (lockstep) на AMD і Apple' },
					{ en: 'Different warp size on some AMD GPUs', de: 'Andere Warp-Größe bei einigen AMD-GPUs', uk: 'Інший розмір warp на деяких GPU AMD' },
					{ en: '32-bit indexes and atomics, software 128-bit arithmetic on Apple', de: '32-Bit-Indizes und -Atomics, 128-Bit-Arithmetik in Software bei Apple', uk: '32-бітні індекси й атомарні операції, програмна 128-бітна арифметика на Apple' }
				] },
			{ at: 2, text: { en: '**Kernel resources**', de: '**Kernel-Ressourcen**', uk: '**Ресурси ядер**' },
				sub: [
					{ en: 'Launch grid auto-sized per kernel from vendor occupancy APIs\n(no fixed register caps that cause spills)', de: 'Launch-Grid pro Kernel automatisch über die Occupancy-APIs der Hersteller bemessen\n(keine festen Registergrenzen, die Spills verursachen)', uk: 'Сітка запуску підбирається для кожного ядра через API заповненості виробника\n(без фіксованих лімітів регістрів, що спричиняють витіснення)' },
					{ en: 'A lean on-device allocator (linking `malloc` can cost 100+ registers)', de: 'Ein schlanker Allokator auf dem Gerät (allein `malloc` zu linken kann 100+ Register kosten)', uk: 'Легкий алокатор на пристрої (саме лише підключення `malloc` може коштувати 100+ регістрів)' },
					{ en: 'Compilation: 69 ms (Q6) to 490 ms (Q2), pipelines in parallel', de: 'Kompilierung: 69 ms (Q6) bis 490 ms (Q2), Pipelines parallel', uk: 'Компіляція: від 69 мс (Q6) до 490 мс (Q2), конвеєри паралельно' }
				] }
		], { size: 27, subSize: 22, gap: 16 }));
		root.append(left);
		lowering(b, root, 930, 140, (s) => (s === 1 ? 'subop' : s === 2 ? 'runtime' : 'all'));
	}
});

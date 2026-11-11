// Slide 5: the core design principle (local, growing, GPU-merged state), how its overhead is kept low,
// and its CPU inspiration, next to the paper's pipeline-kernel figure (Fig. 4, converted from PDF).
import { slide, h, bullets, arrow, canvas } from '../lib.js';
import { pipelineKernel } from '../figs/pipeline-kernel.js';

export default slide({
	name: 'core-idea',
	label: { en: 'Core idea', de: 'Kernidee', uk: 'Основна ідея' },
	title: { en: 'Core idea: local state, grown and merged on the GPU', de: 'Kernidee: lokaler Zustand, auf der GPU gewachsen und zusammengeführt', uk: 'Основна ідея: локальний стан, що росте й зливається на GPU' },
	states: [
		{ name: 'principle', label: { en: 'The principle', de: 'Das Prinzip', uk: 'Принцип' } },
		{ name: 'overhead', label: { en: 'Low overhead', de: 'Wenig Overhead', uk: 'Низькі накладні витрати' } }
	],
	build(b, root) {
		const left = h('div', 'position:absolute;left:80px;top:160px;width:690px;');
		left.append(b.text('div', 'font-size:26px;color:var(--fig-fg);margin-bottom:14px;', {
			en: 'One design principle addresses F1, R1 and P1 together:',
			de: 'Ein Designprinzip löst F1, R1 und P1 gemeinsam:',
			uk: 'Один принцип дизайну розв’язує F1, R1 і P1 разом:'
		}));
		left.append(bullets(b, [
			{ at: 0, text: { en: 'State lives at **thread, warp or thread-block** granularity', de: 'Zustand lebt auf Ebene von **Thread, Warp oder Thread-Block**', uk: 'Стан живе на рівні **потоку, warp або блоку потоків**' } },
			{ at: 0, text: { en: 'It **grows dynamically** (on-device allocator): no cardinality estimates, no global resize barrier', de: 'Er **wächst dynamisch** (Allokator auf dem Gerät): keine Kardinalitätsschätzungen, keine globale Resize-Barriere', uk: 'Він **росте динамічно** (алокатор на пристрої): без оцінок кардинальності та глобального бар’єра для зміни розміру' } },
			{ at: 0, text: { en: 'It is **merged on the GPU**: no shipping of many small states to the CPU', de: 'Er wird **auf der GPU zusammengeführt**: kein Versand vieler kleiner Zustände an die CPU', uk: 'Він **зливається на GPU**: жодного пересилання багатьох малих станів на CPU' } }
		], { size: 27, gap: 12 }));
		root.append(left);

		const ov = h('div', 'position:absolute;left:80px;top:556px;right:80px;');
		ov.append(b.text('div', 'font-size:27px;font-weight:700;margin-bottom:12px;', { en: 'Keeping the overhead low', de: 'Den Overhead klein halten', uk: 'Як тримати накладні витрати низькими' }));
		const cols = h('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:30px;font-size:22px;line-height:1.28;');
		const card = (/** @type {any} */ head, /** @type {any} */ body) => {
			const c = h('div', 'border-top:4px solid var(--fig-accent);padding-top:10px;');
			c.append(b.text('div', 'font-weight:700;margin-bottom:6px;', head), b.text('div', '', body));
			return c;
		};
		cols.append(
			card({ en: 'Multi-tier memory', de: 'Mehrstufiger Speicher', uk: 'Багаторівнева пам’ять' },
				{ en: 'Registers → SMEM → L2 → HBM: the fastest level possible for each data structure', de: 'Register → SMEM → L2 → HBM: für jede Datenstruktur die schnellste mögliche Ebene', uk: 'Регістри → SMEM → L2 → HBM: найшвидший можливий рівень для кожної структури даних' }),
			card({ en: 'Locality per data structure', de: 'Lokalität pro Datenstruktur', uk: 'Локальність для кожної структури' },
				{ en: 'Thread-local accumulators, warp-local buffers, block-local hashtables', de: 'Thread-lokale Akkumulatoren, Warp-lokale Puffer, Block-lokale Hashtabellen', uk: 'Локальні для потоку акумулятори, локальні для warp буфери, локальні для блоку хеш-таблиці' }),
			card({ en: 'Thread-blocks as virtual processors', de: 'Thread-Blöcke als virtuelle Prozessoren', uk: 'Блоки потоків як віртуальні процесори' },
				{ en: 'Launch just enough blocks to fill all GPU cores via work-stealing', de: 'Gerade so viele Blöcke starten, dass alle GPU-Kerne per Work-Stealing ausgelastet sind', uk: 'Запускаємо рівно стільки блоків, щоб заповнити всі ядра GPU через work-stealing' })
		);
		ov.append(cols);
		b.show(ov, 1);
		root.append(ov);

		pipelineKernel(b, root, 790, 146, (s) => (s === 0 ? 'state' : 'loop'));

		// State 2: an arrow from the "Thread-blocks as virtual processors" card (third column, right edge of its
		// heading) around the figure's right side to the dashed loop box (lines 5–8: figure x 712, y 115–207,
		// so root x 1502, mid-height y 307 with the figure at 790,146).
		const link = canvas(1600, 900, 'left:0;top:0;pointer-events:none;');
		link.append(arrow([1526, 628], [1508, 307], { c1: [1585, 628], c2: [1585, 307], width: 3, dash: '8 5', color: 'var(--fig-accent2)' }));
		b.part(link, (s) => ({ opacity: s >= 1 ? 1 : 0 }), { delay: (f, t) => (t > f ? 600 : 0) });
		root.append(link);

		const morsel = b.text('div', 'position:absolute;left:80px;right:80px;top:836px;font-size:24px;color:var(--fig-fg);font-style:italic;', {
			en: 'Inspired by morsel-driven parallelism on CPUs, adapted to the GPU’s hierarchy.',
			de: 'Inspiriert von Morsel-driven Parallelism auf CPUs, angepasst an die Hierarchie der GPU.',
			uk: 'Натхненно morsel-driven паралелізмом на CPU, адаптованим до ієрархії GPU.'
		});
		b.show(morsel, 1);
		root.append(morsel);
	}
});

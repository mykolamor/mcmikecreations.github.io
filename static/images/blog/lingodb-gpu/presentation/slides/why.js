// Slide 2: hardware trends (three stat cards), "not whether but how", then the practical-vs-fast contrast
// with the gap in the middle, and the research question.
import { slide, h } from '../lib.js';

const CARDS = [
	{ big: { en: '288 GB · ~22 TB/s', de: '288 GB · ~22 TB/s', uk: '288 ГБ · ~22 ТБ/с' },
		text: { en: 'HBM on the upcoming Nvidia Rubin', de: 'HBM der kommenden Nvidia Rubin', uk: 'HBM у майбутній Nvidia Rubin' } },
	{ big: { en: '900 GB/s', de: '900 GB/s', uk: '900 ГБ/с' },
		text: { en: 'Cheap or free CPU-GPU data movement', de: 'Günstiger oder kostenloser Datentransfer CPU-GPU', uk: 'Дешеве або безкоштовне переміщення даних CPU-GPU' } },
	{ big: { en: '100s × ~1000', de: '100e × ~1000', uk: 'сотні × ~1000' },
		text: { en: 'Hundreds of cores, each running about a thousand threads', de: 'Hunderte Kerne mit jeweils etwa tausend Threads', uk: 'Сотні ядер, кожне з приблизно тисячею потоків' } }
];

export default slide({
	name: 'why',
	label: { en: 'Why GPUs? Why now?', de: 'Warum GPUs? Warum jetzt?', uk: 'Чому GPU? Чому зараз?' },
	title: { en: 'Why GPUs? Why now? And where is the gap?', de: 'Warum GPUs? Warum jetzt? Und wo ist die Lücke?', uk: 'Чому GPU? Чому зараз? І де розрив?' },
	states: [
		{ name: 'trends', label: { en: 'Hardware trends', de: 'Hardware-Trends', uk: 'Апаратні тренди' } },
		{ name: 'how', label: { en: 'Not whether, but how', de: 'Nicht ob, sondern wie', uk: 'Не чи, а як' } },
		{ name: 'gap', label: { en: 'The gap', de: 'Die Lücke', uk: 'Розрив' } },
		{ name: 'question', label: { en: 'The question', de: 'Die Frage', uk: 'Питання' } }
	],
	build(b, root) {
		const lead = b.text('div', 'position:absolute;left:80px;top:150px;font-size:32px;color:var(--fig-fg);', {
			en: 'AI drives GPU improvements',
			de: 'KI treibt GPU-Verbesserungen voran',
			uk: 'ШІ стимулює вдосконалення GPU'
		});
		b.show(lead, 0, 2);
		root.append(lead);
		const cards = h('div', 'position:absolute;left:80px;right:80px;top:220px;display:grid;grid-template-columns:repeat(3,1fr);gap:36px;');
		CARDS.forEach((c, i) => {
			const card = h('div', 'border:2px solid var(--fig-dim);border-radius:18px;padding:30px 30px 34px;display:flex;flex-direction:column;gap:16px;');
			card.append(
				b.text('div', 'font-size:46px;font-weight:800;color:var(--fig-accent);white-space:nowrap;', c.big),
				b.text('div', 'font-size:28px;line-height:1.3;', c.text)
			);
			b.part(card, (s) => ({ opacity: s < 2 ? 1 : 0, translateY: s < 2 ? 0 : -30 }), { delay: (f, t) => (t > f ? i * 40 : 200 + i * 60) });
			cards.append(card);
		});
		root.append(cards);
		const how = b.text('div', 'position:absolute;left:80px;right:80px;top:620px;font-size:44px;font-weight:700;text-align:center;', {
			en: 'The question is no longer *whether* to use GPUs, but **how**.',
			de: 'Die Frage ist nicht mehr, *ob* man GPUs nutzt, sondern **wie**.',
			uk: 'Питання вже не в тому, *чи* використовувати GPU, а в тому, **як**.'
		});
		b.show(how, 1, 2);
		root.append(how);

		// The gap: two columns with a dashed chasm between them.
		const gap = h('div', 'position:absolute;left:80px;right:80px;top:170px;height:470px;display:grid;grid-template-columns:1fr 260px 1fr;');
		const col = (/** @type {string} */ accent, /** @type {any} */ head, /** @type {any} */ who, /** @type {any} */ how2, /** @type {any} */ catch_) => {
			const c = h('div', `border-radius:18px;border:3px solid ${accent};padding:30px 34px;display:flex;flex-direction:column;gap:18px;`);
			c.append(
				b.text('div', `font-size:42px;font-weight:800;color:${accent};`, head),
				b.text('div', 'font-size:30px;font-weight:600;', who),
				b.text('div', 'font-size:28px;line-height:1.32;', how2),
				b.text('div', 'font-size:28px;line-height:1.32;color:var(--fig-fg);', catch_)
			);
			return c;
		};
		const left = col('var(--fig-accent)',
			{ en: 'Practical systems', de: 'Praxistaugliche Systeme', uk: 'Практичні системи' },
			{ en: 'Sirius, GQE, Maximus (on cuDF); TQP (on PyTorch)', de: 'Sirius, GQE, Maximus (auf cuDF); TQP (auf PyTorch)', uk: 'Sirius, GQE, Maximus (на cuDF); TQP (на PyTorch)' },
			{ en: 'Run **operator-at-a-time**', de: 'Laufen **Operator für Operator**', uk: 'Виконують **по одному оператору**' },
			{ en: 'Materialize intermediates in global memory', de: 'Materialisieren Zwischenergebnisse im globalen Speicher', uk: 'Матеріалізують проміжні результати в глобальній пам’яті' });
		const right = col('var(--fig-accent)',
			{ en: 'Academic prototypes', de: 'Akademische Prototypen', uk: 'Академічні прототипи' },
			{ en: 'Crystal, DogQC, Themis', de: 'Crystal, DogQC, Themis', uk: 'Crystal, DogQC, Themis' },
			{ en: '**Fuse operators**: much faster', de: '**Fusionieren Operatoren**: viel schneller', uk: '**Зливають оператори**: набагато швидші' },
			{ en: 'Only on narrow, hand-tuned workloads', de: 'Nur auf engen, von Hand optimierten Workloads', uk: 'Лише на вузьких, вручну налаштованих навантаженнях' });
		const mid = h('div', 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;');
		mid.append(
			h('div', 'flex:1;border-left:4px dashed var(--fig-accent2);'),
			b.text('div', 'font-size:40px;font-weight:800;color:var(--fig-accent2);letter-spacing:0.12em;', { en: 'GAP', de: 'LÜCKE', uk: 'РОЗРИВ' }),
			h('div', 'flex:1;border-left:4px dashed var(--fig-accent2);')
		);
		b.part(left, (s) => ({ opacity: s >= 2 ? 1 : 0, translateX: s >= 2 ? 0 : -60 }));
		b.part(right, (s) => ({ opacity: s >= 2 ? 1 : 0, translateX: s >= 2 ? 0 : 60 }));
		b.part(mid, (s) => ({ opacity: s >= 2 ? 1 : 0, scaleY: s >= 2 ? 1 : 0.2 }), { delay: (f, t) => (t > f ? 700 : 0) });
		gap.append(left, mid, right);
		root.append(gap);

		const q = h('div', 'position:absolute;left:80px;right:80px;top:690px;padding:26px 34px;border-radius:18px;background:color-mix(in srgb, var(--fig-accent) 14%, transparent);font-size:36px;font-weight:600;text-align:center;');
		q.append(b.text('span', '', {
			en: 'What does it take to make fused execution **practical** without losing its **performance**?',
			de: 'Was braucht es, damit fusionierte Ausführung **praxistauglich** wird, ohne ihre **Performance** zu verlieren?',
			uk: 'Що потрібно, щоб злите виконання стало **практичним**, не втративши **продуктивності**?'
		}));
		b.show(q, 3);
		root.append(q);
	}
});

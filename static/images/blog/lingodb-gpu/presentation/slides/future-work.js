// Future work, right after the conclusion. The submitted paper has no future-work section, so this combines its "Orthogonal
// axes" paragraph (Related Work) and the limitations named in the implementation and evaluation sections
// with the explicit future-work lines of the earlier draft (data transfers, multi-PU, divergence handling),
// then the people and projects working on the first four topics; the same for the LingoDB/GPU points.
import { slide, h, bullets, same } from '../lib.js';

// People and projects working on the out-of-scope topics, shown in state 2 next to their topic (bullet index).
// Titles and names stay as they are in every language.
const PROJECTS = [
	[0, [
		{ title: 'Stabilizing discrete GPU Unified Memory Performance Under Oversubscription', who: 'Senad Lemes Galera' },
		{ title: 'Making Unified Virtual Memory Practical for Discrete-Memory GPUs', who: 'Michalis Georgoulakis' }
	]],
	[1, [
		{ tag: 'DataPro', title: 'GPU Flying Start', who: 'Haochen Feng' },
		{ title: 'LingoDB Compilation Refactor', who: 'Lukas Haußmann' }
	]],
	[2, [{ tag: 'DataPro', title: 'Adaptive Query Execution', who: 'Jonas Neubacher' }]],
	[3, [
		{ title: 'AnyCode: Blurring the Boundary Between Native and External Decoders', who: 'Mateusz Gienieczko, Mykola Morozov' },
		{ title: 'On-demand eBPF Decompression', who: 'Xinyi Cui' }
	]]
];

// Projects for the "Inside LingoDB/GPU" points, shown in state 4 in the (then empty) left half.
const INSIDE_PROJECTS = [
	[1, [{ tag: 'DataPro', title: 'GPU Execution on Vulkan and MoltenVK', who: 'Mohamed Amine Mnif, Rayen Ben Moussa, Adrian Würth' }]],
	[0, [{ title: 'Fast JIT Compilation for GPU-Accelerated Database Systems', who: 'Viet Chi Quan Nguyen' }]],
	[3, [{ title: 'Efficient warp-cooperative pattern matching in GPU accelerated databases', who: 'Hendrik Huebner' }]],
	[4, [
		{ tag: 'DataPro', title: 'MoltenVK CPU-GPU co-processing', who: 'Yu-Ting Tsai' },
		{ title: 'Half the FLOPS, the Same Bandwidth: Lessons from Apple Unified Memory for GPU Database Operators', who: 'Simon Ellmann, Julia Spindler' }
	]]
];

export default slide({
	name: 'future-work',
	label: { en: 'Future and related work', de: 'Ausblick und verwandte Arbeiten', uk: 'Подальша та пов’язана робота' },
	title: { en: 'Future and related work', de: 'Ausblick und verwandte Arbeiten', uk: 'Подальша та пов’язана робота' },
	states: [
		{ name: 'beyond', label: { en: 'Beyond the scope', de: 'Über den Umfang hinaus', uk: 'За межами роботи' } },
		{ name: 'people', label: { en: 'Who is working on it', de: 'Wer daran arbeitet', uk: 'Хто над цим працює' } },
		{ name: 'inside', label: { en: 'Inside LingoDB/GPU', de: 'In LingoDB/GPU', uk: 'Усередині LingoDB/GPU' } },
		{ name: 'inside-people', label: { en: 'Who is working on it inside LingoDB/GPU', de: 'Wer in LingoDB/GPU daran arbeitet', uk: 'Хто над цим працює в LingoDB/GPU' } }
	],
	build(b, root) {
		const cols = h('div', 'position:absolute;left:80px;right:80px;top:170px;display:grid;grid-template-columns:1fr 1fr;column-gap:60px;');
		const column = (/** @type {number} */ at, /** @type {any} */ head, /** @type {HTMLElement} */ list) => {
			const c = h('div', ''); // each state shows only its own column; the other keeps its place, hidden
			c.append(b.text('div', 'font-size:32px;font-weight:800;color:var(--fig-accent);padding-bottom:10px;margin-bottom:22px;border-bottom:3px solid var(--fig-accent);', head), list);
			b.show(c, at, at === 0 ? 2 : Infinity); // "Beyond the scope" stays for the people state
			cols.append(c);
			return list;
		};

		const beyond = column(0, { en: 'Beyond the scope', de: 'Über den Umfang hinaus', uk: 'За межами роботи' }, bullets(b, [
			{ at: 0, until: 2, text: { en: '**CPU-GPU transfers**', de: '**Transfers CPU-GPU**', uk: '**Передачі CPU-GPU**' },
				sub: [{ en: 'Overlap, compression, pinned or mapped memory can replace our asynchronous loading; work stealing stays as is', de: 'Überlappung, Kompression, Pinned oder Mapped Memory können unser asynchrones Laden ersetzen; Work-Stealing bleibt, wie es ist', uk: 'Перекриття, стиснення, закріплена чи відображена пам’ять можуть замінити наше асинхронне завантаження; work-stealing лишається як є' }] },
			{ at: 0, until: 2, text: { en: '**CPU/GPU co-processing**', de: '**CPU/GPU-Co-Processing**', uk: '**Спільна обробка CPU/GPU**' },
				sub: [{ en: 'CPU and GPU share MLIR primitives, but their lowerings are still separate', de: 'CPU und GPU teilen sich MLIR-Primitive, aber ihre Lowerings sind noch getrennt', uk: 'CPU і GPU мають спільні примітиви MLIR, але їхні пониження поки окремі' }] },
			{ at: 0, until: 2, text: { en: '**Concurrent queries**', de: '**Nebenläufige Anfragen**', uk: '**Паралельні запити**' },
				sub: [{ en: 'Scheduling many queries on one GPU and sharing its resources;\nisolation and virtualization', de: 'Viele Anfragen auf einer GPU einplanen und ihre Ressourcen teilen;\nIsolation und Virtualisierung', uk: 'Планування багатьох запитів на одному GPU та спільне використання його ресурсів;\nізоляція та віртуалізація' }] },
			{ at: 0, until: 2, text: { en: '**Compression**', de: '**Kompression**', uk: '**Стиснення**' },
				sub: [{ en: 'Query compressed data directly to save memory and bandwidth', de: 'Direkt auf komprimierten Daten rechnen, um Speicher und Bandbreite zu sparen', uk: 'Обробка безпосередньо стиснених даних, щоб заощадити пам’ять і пропускну здатність' }] },
			{ at: 0, until: 2, text: { en: '**Multi-GPU**', de: '**Multi-GPU**', uk: '**Кілька GPU**' },
				sub: [{ en: 'Exchange operators over NCCL or RDMA', de: 'Exchange-Operatoren über NCCL oder RDMA', uk: 'Оператори обміну через NCCL або RDMA' }] }
		], { size: 28, subSize: 22, gap: 20 }));

		const inside = column(2, { en: 'Inside LingoDB/GPU', de: 'In LingoDB/GPU', uk: 'Усередині LingoDB/GPU' }, bullets(b, [
			{ at: 2, text: { en: '**Faster compilation**', de: '**Schnellere Kompilierung**', uk: '**Швидша компіляція**' },
				sub: [{ en: '69–490 ms on TPC-H today; CPU-style engineering can cut it further', de: 'Heute 69–490 ms bei TPC-H; Engineering wie bei CPUs kann das weiter senken', uk: 'Зараз 69–490 мс на TPC-H; інженерні підходи, як для CPU, можуть це скоротити' }] },
			{ at: 2, text: { en: '**Fixed setup cost**', de: '**Feste Setup-Kosten**', uk: '**Фіксовані витрати на підготовку**' },
				sub: [{ en: '0.2–1.5 ms per query, 21–38% of the ~1–3 ms SSB queries', de: '0,2–1,5 ms pro Anfrage, 21–38 % der SSB-Anfragen von ~1–3 ms', uk: '0,2–1,5 мс на запит, 21–38 % SSB-запитів тривалістю ~1–3 мс' }] },
			{ at: 2, text: { en: '**Divergence handling**', de: '**Umgang mit Divergenz**', uk: '**Боротьба з дивергенцією**' },
				sub: [{ en: 'Lane refill and SMEM shuffles as extra sub-operators, picked by the optimizer per workload', de: 'Lane-Refill und SMEM-Shuffles als zusätzliche Sub-Operatoren, vom Optimierer pro Workload gewählt', uk: 'Дозаповнення потоків і перемішування через SMEM як додаткові підоператори, які оптимізатор обирає під навантаження' }] },
			{ at: 2, text: { en: '**Complex data handling**', de: '**Umgang mit komplexen Daten**', uk: '**Обробка складних даних**' },
				sub: [{ en: 'String processing, geospatial data, JSON, nested types and arrays, regular expressions', de: 'String-Verarbeitung, Geodaten, JSON, verschachtelte Typen und Arrays, reguläre Ausdrücke', uk: 'Обробка рядків, геопросторові дані, JSON, вкладені типи й масиви, регулярні вирази' }] },
			{ at: 2, text: { en: '**Shared and unified memory**', de: '**Shared und Unified Memory**', uk: '**Спільна та уніфікована пам’ять**' },
				sub: [{ en: 'Dynamic page remapping, chiplet utilization, zero-copy CPU-GPU access, NUMA-aware data placement', de: 'Dynamisches Page-Remapping, Auslastung der Chiplets, Zero-Copy-Zugriff CPU-GPU, NUMA-bewusste Datenplatzierung', uk: 'Динамічне перевідображення сторінок, використання чиплетів, доступ CPU-GPU без копіювання, розміщення даних з урахуванням NUMA' }] }
		], { size: 28, subSize: 22, gap: 20 }));

		// Project cards next to their topic, in whichever half is empty in that state: right of "Beyond the scope"
		// (state 2), left of "Inside LingoDB/GPU" (state 4). The cards are absolutely placed in the topic's <li>, so
		// the list layout doesn't change, and sit at the topic's height in every language without measuring.
		const AMBER = 'var(--fig-accent2)';
		const attach = (/** @type {HTMLElement} */ list, /** @type {any[]} */ entries, /** @type {number} */ state, /** @type {'right' | 'left'} */ side) => {
			for (const [i, projects] of entries) {
				const li = /** @type {HTMLElement} */ (list.children[Number(i)]);
				li.style.position = 'relative';
				let conn;
				if (side === 'right') {
					// The arrow grows from the end of the heading across the column gap.
					const body = /** @type {HTMLElement} */ (li.lastElementChild);
					const heading = /** @type {HTMLElement} */ (body.firstElementChild);
					const row = h('div', 'display:flex;align-items:center;');
					body.insertBefore(row, heading);
					heading.style.flex = 'none';
					conn = h('div', `flex:1;min-width:40px;height:0;margin:0 -50px 0 18px;border-top:3px dashed ${AMBER};position:relative;`);
					conn.append(h('div', `position:absolute;right:-2px;top:-9px;width:0;height:0;border-left:15px solid ${AMBER};border-top:7.5px solid transparent;border-bottom:7.5px solid transparent;`));
					row.append(heading, conn);
				} else {
					// The heading starts at the column's left edge, so the arrow spans the gap from its bullet dot.
					conn = h('div', `position:absolute;right:calc(100% + 8px);width:44px;top:17px;height:0;border-top:3px dashed ${AMBER};`);
					conn.append(h('div', `position:absolute;left:-2px;top:-9px;width:0;height:0;border-right:15px solid ${AMBER};border-top:7.5px solid transparent;border-bottom:7.5px solid transparent;`));
					li.append(conn);
				}
				b.part(conn, (st) => ({ opacity: st === state ? 1 : 0 }), { duration: 350 });

				// Cards fill from the arrow outwards: left to right on the right side, right to left on the left side.
				const group = h('div', `position:absolute;${side === 'right' ? 'left' : 'right'}:calc(100% + 60px);top:0;width:100%;display:flex;flex-direction:${side === 'right' ? 'row' : 'row-reverse'};gap:20px;`);
				for (const p of /** @type {{ tag?: string, title: string, who: string }[]} */ (projects)) {
					const card = h('div', `flex:0 0 calc(50% - 10px);box-sizing:border-box;border:2px solid var(--fig-dim);border-radius:12px;padding:10px 16px 12px;display:flex;flex-direction:column;gap:6px;background:var(--fig-bg);`);
					card.append(b.text('div', 'font-size:17px;font-weight:700;line-height:1.25;', same(`“${p.title}”`)), b.text('div', 'font-size:16px;color:var(--fig-fg);', same(p.who)));
					if (p.tag) card.append(h('div', `font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${AMBER};`, p.tag));
					group.append(card);
				}
				const dx = side === 'right' ? 30 : -30;
				b.part(group, (st) => ({ opacity: st === state ? 1 : 0, translateX: st === state ? 0 : dx }), { delay: (f, t) => (t > f ? 200 : 0) });
				li.append(group);
			}
		};
		attach(beyond, PROJECTS, 1, 'right');
		attach(inside, INSIDE_PROJECTS, 3, 'left');

		root.append(cols);
	}
});

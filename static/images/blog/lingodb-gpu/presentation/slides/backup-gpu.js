// Backup B: GPU architecture primer next to the paper's Fig. 1 (gpu-structure, converted from PDF).
import { slide, h, bullets } from '../lib.js';
import { gpuStructure } from '../figs/gpu-structure.js';

export default slide({
	name: 'backup-gpu',
	label: { en: 'Backup: GPU architecture primer', de: 'Backup: GPU-Architektur in Kürze', uk: 'Резерв: коротко про архітектуру GPU' },
	title: { en: 'Backup: GPU architecture primer', de: 'Backup: GPU-Architektur in Kürze', uk: 'Резерв: коротко про архітектуру GPU' },
	states: [
		{ name: 'hierarchy', label: { en: 'Thread hierarchy', de: 'Thread-Hierarchie', uk: 'Ієрархія потоків' } },
		{ name: 'resources', label: { en: 'Occupancy and L2', de: 'Occupancy und L2', uk: 'Заповненість і L2' } }
	],
	build(b, root) {
		gpuStructure(b, root, 80, 180, (s) => (s === 0 ? 'blocks' : 'memory'));
		const right = h('div', 'position:absolute;left:990px;right:70px;top:170px;');
		right.append(bullets(b, [
			{ at: 0, text: { en: 'Threads → **warps** (32, SIMT) → **thread-blocks** (share SMEM and barriers) → **SMs**', de: 'Threads → **Warps** (32, SIMT) → **Thread-Blöcke** (teilen SMEM und Barrieren) → **SMs**', uk: 'Потоки → **warp** (32, SIMT) → **блоки потоків** (спільні SMEM і бар’єри) → **SM**' } },
			{ at: 1, text: { en: 'Register and SMEM usage determine **occupancy**', de: 'Register- und SMEM-Verbrauch bestimmen die **Occupancy**', uk: 'Використання регістрів і SMEM визначає **заповненість**' } },
			{ at: 1, text: { en: '**L2** resolves global atomics', de: '**L2** löst globale Atomics auf', uk: '**L2** виконує глобальні атомарні операції' } }
		], { size: 30, gap: 28 }));
		root.append(right);
	}
});

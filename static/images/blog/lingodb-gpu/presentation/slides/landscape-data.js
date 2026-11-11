// Data for slide 3a: GPU database engines from the SmackDB notes (tag `gpu-wave`, topic `gpu-databases`),
// with the citation tier of each engine's defining paper (Semantic Scholar, cross-checked with OpenAlex,
// retrieved 2026-11-10; see gpu-paper-slides.md), and the final classification table from the paper.
// Pure constants: the cloud layout is computed once from a fixed seed, so every mount looks the same.

/** Font size (px) in the cloud per citation tier. XL ≥150, L 75–149, M 30–74, S 10–29, XS <10 or none. */
export const TIER_PX = { XL: 60, L: 44, M: 32, S: 25, XS: 19 };

/** Table geometry in slide px. Header row 1 (merged groups), header row 2 (styles), 8 body rows. */
export const TABLE = { x: 60, colW: 296, top: 136, h1: 46, h2: 92, rowH: 54, rows: 8, font: 22 };
export const bodyTop = TABLE.top + TABLE.h1 + TABLE.h2;

/** Header row 1: [label, first column, span]. */
export const GROUPS = [
	[{ en: 'Fused Operators', de: 'Fusionierte Operatoren', uk: 'Злиті оператори' }, 0, 2],
	[{ en: 'Vectorized Execution', de: 'Vektorisierte Ausführung', uk: 'Векторизоване виконання' }, 2, 1],
	[{ en: 'Operator-at-a-time', de: 'Operator für Operator', uk: 'По одному оператору' }, 3, 2]
];
/** Header row 2, one per column. */
export const STYLES = [
	{ en: 'Data-centric tuple-at-a-time', de: 'Datenzentriert, Tupel für Tupel', uk: 'Дата-центричне, кортеж за кортежем' },
	{ en: 'Vectorized style', de: 'Vektorisierter Stil', uk: 'Векторизований стиль' },
	{ en: 'Data size proportional to shared memory or cache', de: 'Datengröße proportional zu Shared Memory oder Cache', uk: 'Розмір даних пропорційний спільній пам’яті або кешу' },
	{ en: 'Full materialization between each operator', de: 'Volle Materialisierung zwischen allen Operatoren', uk: 'Повна матеріалізація між операторами' },
	{ en: 'Streaming or running all OPs over big chunk of data', de: 'Streaming oder alle Operatoren über große Datenblöcke', uk: 'Потокова обробка або всі оператори над великим блоком даних' }
];

/**
 * Engines. `cell` = [column, row] in the table (absent: fades out); `dx` shifts within the cell;
 * `merge` = flies into another engine's cell and fades (renamed product);
 * `co` = supports co-processing (⇄).
 * @type {{ name: string, tier: keyof typeof TIER_PX, cell?: [number, number], dx?: number, co?: boolean, merge?: boolean }[]}
 */
export const ENGINES = [
	// Into the table.
	{ name: 'GPUQP', tier: 'XL', cell: [2, 0], co: true },
	{ name: 'GPUDB', tier: 'XL', cell: [3, 1], co: true },
	{ name: 'Crystal', tier: 'L', cell: [1, 0] },
	{ name: 'HorseQC', tier: 'L', cell: [0, 3] },
	{ name: 'Proteus', tier: 'L', cell: [0, 2], co: true },
	{ name: 'NebulaStream', tier: 'L', cell: [1, 2] },
	{ name: 'CoGaDB', tier: 'L', cell: [4, 0], co: true },
	{ name: 'TQP', tier: 'M', cell: [3, 0] },
	{ name: 'OmniDB', tier: 'M', cell: [2, 1], co: true },
	{ name: 'RateupDB', tier: 'M', cell: [3, 2] },
	{ name: 'Crystal-Opt', tier: 'M', cell: [1, 1] },
	{ name: 'DogQC', tier: 'M', cell: [0, 4] },
	{ name: 'MapD', tier: 'M', cell: [0, 1] },
	{ name: 'OmniSci', tier: 'M', cell: [0, 1], merge: true },
	{ name: 'HeavyDB', tier: 'M', cell: [0, 1], merge: true },
	{ name: 'Pyper', tier: 'M', cell: [0, 5] },
	{ name: 'Vortex', tier: 'S', cell: [3, 3] },
	{ name: 'Themis', tier: 'S', cell: [0, 6] },
	{ name: 'Maximus', tier: 'S', cell: [2, 6], co: true },
	{ name: 'Theseus', tier: 'S', cell: [2, 5] },
	{ name: 'r3d3', tier: 'XS', cell: [0, 0] },
	{ name: 'rNdN', tier: 'XS', cell: [0, 0], dx: 90 },
	{ name: 'PystachIO', tier: 'XS', cell: [2, 3] },
	{ name: 'Sirius', tier: 'XS', cell: [2, 7] },
	{ name: 'GQE', tier: 'XS', cell: [4, 2] },
	{ name: 'Velox cuDF', tier: 'XS', cell: [2, 2], co: true },
	{ name: 'BlazingSQL', tier: 'XS', cell: [2, 4] },
	{ name: 'Kinetica', tier: 'XS', cell: [4, 1], co: true },
	// Fade out.
	{ name: 'Sphyraena', tier: 'XL' },
	{ name: 'Ocelot', tier: 'XL' },
	{ name: 'SABER', tier: 'L' },
	{ name: 'Voodoo', tier: 'L' },
	{ name: 'Kernel Weaver', tier: 'L' },
	{ name: 'HippogriffDB', tier: 'L' },
	{ name: 'Red Fox', tier: 'L' },
	{ name: 'GPL', tier: 'L' },
	{ name: 'GPUTx', tier: 'L' },
	{ name: 'Hawk', tier: 'M' },
	{ name: 'Mordred', tier: 'M' },
	{ name: 'TCUDB', tier: 'M' },
	{ name: 'GaccO', tier: 'M' },
	{ name: 'FineStream', tier: 'M' },
	{ name: 'GOLAP', tier: 'S' },
	{ name: 'FineQuery', tier: 'S' },
	{ name: 'Lancelot', tier: 'S' },
	{ name: 'NestGPU', tier: 'S' },
	{ name: 'HorseIR', tier: 'S' },
	{ name: 'SPADE', tier: 'S' },
	{ name: 'GHive', tier: 'XS' },
	{ name: 'CoddSpeed', tier: 'XS' },
	{ name: 'Hetero-DB', tier: 'XS' },
	{ name: 'G-SDMS', tier: 'XS' },
	{ name: 'LTPG', tier: 'XS' },
	{ name: 'SQream', tier: 'XS' },
	{ name: 'TQEx', tier: 'XS' },
	{ name: 'SHADB', tier: 'XS' },
	{ name: 'SYCLDB', tier: 'XS' },
	{ name: 'DMO-DB', tier: 'XS' },
	{ name: 'Virginian', tier: 'XS' },
	{ name: 'CuDB', tier: 'XS' },
	{ name: 'PG-Strom', tier: 'XS' },
	{ name: 'Brytlyt', tier: 'XS' },
	{ name: 'ParStream', tier: 'XS' },
	{ name: 'AresDB', tier: 'XS' }
];

/** Deterministic PRNG (mulberry32). @param {number} seed */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Cloud area (slide px), below the title and above the caption. */
const AREA = { x0: 50, x1: 1550, y0: 140, y1: 800 };

/**
 * Cloud position per engine: x, y = left-centre anchor of the word, `rot` in degrees, `scale` relative to
 * the table font. Words are placed largest first at random spots/angles, rejecting overlaps.
 * @returns {{ out: { x: number, y: number, rot: number, scale: number }[], misses: number }}
 */
function layoutCloud() {
	const rand = rng(20261110);
	/** @type {{ x0: number, y0: number, x1: number, y1: number }[]} */
	const placed = [];
	const out = new Array(ENGINES.length);
	const order = ENGINES.map((_, i) => i).sort((a, b) => TIER_PX[ENGINES[b].tier] - TIER_PX[ENGINES[a].tier]);
	let misses = 0;
	for (const i of order) {
		const e = ENGINES[i];
		const px = TIER_PX[e.tier];
		const w = e.name.length * px * 0.58;
		const hh = px * 1.15;
		let best = null;
		let bestOverlap = Infinity;
		for (let tries = 0; tries < 900; tries++) {
			const rot = rand() < 0.3 ? 0 : (rand() * 2 - 1) * 32;
			const r = (rot * Math.PI) / 180;
			const c = Math.cos(r);
			const s = Math.sin(r);
			// Corners of the rotated box around its left-centre anchor.
			const cs = [[0, -hh / 2], [w, -hh / 2], [w, hh / 2], [0, hh / 2]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
			const bx0 = Math.min(...cs.map((p) => p[0]));
			const bx1 = Math.max(...cs.map((p) => p[0]));
			const by0 = Math.min(...cs.map((p) => p[1]));
			const by1 = Math.max(...cs.map((p) => p[1]));
			const x = AREA.x0 - bx0 + rand() * (AREA.x1 - AREA.x0 - (bx1 - bx0));
			const y = AREA.y0 - by0 + rand() * (AREA.y1 - AREA.y0 - (by1 - by0));
			const box = { x0: x + bx0 - 6, x1: x + bx1 + 6, y0: y + by0 - 4, y1: y + by1 + 4 };
			let overlap = 0;
			for (const p of placed) {
				const ox = Math.min(box.x1, p.x1) - Math.max(box.x0, p.x0);
				const oy = Math.min(box.y1, p.y1) - Math.max(box.y0, p.y0);
				if (ox > 0 && oy > 0) overlap += ox * oy;
			}
			if (overlap < bestOverlap) {
				bestOverlap = overlap;
				best = { x, y, rot, scale: px / TABLE.font, box };
			}
			if (overlap === 0) break;
		}
		if (bestOverlap > 0) misses++;
		if (!best) throw new Error('unreachable');
		placed.push(best.box);
		out[i] = { x: best.x, y: best.y, rot: best.rot, scale: best.scale };
	}
	return { out, misses };
}
const cloud = layoutCloud();
/** @type {{ x: number, y: number, rot: number, scale: number }[]} */
export const CLOUD = cloud.out;
/** Number of words that couldn't be placed without overlap (0 for this seed). */
export const CLOUD_MISSES = cloud.misses;

/** Table position (left-centre anchor) for an engine with a cell. @param {typeof ENGINES[number]} e */
export function cellPos(e) {
	if (!e.cell) return null;
	const [c, r] = e.cell;
	return { x: TABLE.x + c * TABLE.colW + 14 + (e.dx ?? 0), y: bodyTop + r * TABLE.rowH + TABLE.rowH / 2 };
}

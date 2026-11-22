/**
 * The SmackDB tech tree's timelines (`/projects/smackdb/`): one per database sub-area, shown in this order, each
 * split into hand-picked eras. A post's `techTree.year` picks its era column. Labels live in the string tables under
 * `techTree.timelines.<key>.name` and `techTree.timelines.<key>.eras.<era>`.
 *
 * Framework-free.
 */

/** Years are inclusive; `to: null` is open-ended (last era only). */
export interface EraDef {
	key: string;
	from: number;
	to: number | null;
}

export interface TimelineDef {
	key: string;
	eras: EraDef[];
}

export const TIMELINES: TimelineDef[] = [
	{
		key: 'query-processing',
		eras: [
			{ key: 'relational', from: 1970, to: 1989 },
			{ key: 'vectorized', from: 1990, to: 2009 },
			{ key: 'compiled', from: 2010, to: 2019 },
			{ key: 'accelerated', from: 2020, to: null }
		]
	}
];

/** Throws unless timeline keys are unique and each timeline's eras run in order without gaps or overlaps. */
export function validateTimelines(defs: TimelineDef[]): void {
	const keys = new Set<string>();
	for (const tl of defs) {
		if (keys.has(tl.key)) throw new Error(`Tech tree timeline "${tl.key}" is defined twice`);
		keys.add(tl.key);
		if (tl.eras.length === 0) throw new Error(`Tech tree timeline "${tl.key}" has no eras`);
		tl.eras.forEach((era, i) => {
			const where = `Tech tree timeline "${tl.key}", era "${era.key}"`;
			const last = i === tl.eras.length - 1;
			if (era.to === null && !last) throw new Error(`${where}: only the last era may be open-ended`);
			if (era.to !== null && era.to < era.from) throw new Error(`${where}: ends before it starts`);
			const prev = tl.eras[i - 1];
			if (prev && prev.to !== null && era.from !== prev.to + 1) {
				throw new Error(`${where}: must start the year after "${prev.key}" ends (${prev.to + 1})`);
			}
		});
	}
}

validateTimelines(TIMELINES);

import type { NormalizedPresentation, NormalizedSlide, PresentationDef, Position, PositionRef, StateDef } from './types';

export function normalize(def: PresentationDef, fallbackName?: string): NormalizedPresentation {
	if (!def.slides?.length) throw new Error('Presentation has no slides');
	const seen = new Set<string>();
	const slides: NormalizedSlide[] = def.slides.map((s, i) => {
		if (s.name !== undefined) {
			if (seen.has(s.name)) throw new Error(`Duplicate slide name "${s.name}"`);
			seen.add(s.name);
		}
		const raw = s.states ?? 1;
		const states: StateDef[] = typeof raw === 'number' ? Array.from({ length: Math.max(0, Math.floor(raw)) }, () => ({})) : raw.map((x) => ({ ...x }));
		if (states.length < 1) throw new Error(`Slide ${s.name ?? i} needs at least one state`);
		const names = new Set<string>();
		for (const st of states) {
			if (st.name === undefined) continue;
			if (names.has(st.name)) throw new Error(`Duplicate state name "${st.name}" in slide ${s.name ?? i}`);
			names.add(st.name);
		}
		return { def: s, name: s.name, label: s.label, states };
	});
	return { name: def.name ?? fallbackName ?? 'presentation', slides };
}

export function resolve(p: NormalizedPresentation, ref: PositionRef): Position | null {
	const slide = typeof ref.slide === 'string' ? p.slides.findIndex((s) => s.name === ref.slide) : ref.slide;
	if (!Number.isInteger(slide) || slide < 0 || slide >= p.slides.length) return null;
	const states = p.slides[slide].states;
	const s = ref.state ?? 0;
	const state = typeof s === 'string' ? states.findIndex((x) => x.name === s) : s;
	if (!Number.isInteger(state) || state < 0 || state >= states.length) return null;
	return { slide, state };
}

export function neighbour(p: NormalizedPresentation, pos: Position, dir: 1 | -1): Position | null {
	const next = pos.state + dir;
	if (next >= 0 && next < p.slides[pos.slide].states.length) return { slide: pos.slide, state: next };
	const slide = pos.slide + dir;
	if (slide < 0 || slide >= p.slides.length) return null;
	return { slide, state: dir === 1 ? 0 : p.slides[slide].states.length - 1 };
}

export function adjacency(p: NormalizedPresentation, a: Position, b: Position): 1 | -1 | 0 {
	for (const dir of [1, -1] as const) {
		const n = neighbour(p, a, dir);
		if (n && n.slide === b.slide && n.state === b.state) return dir;
	}
	return 0;
}

export function initialPosition(p: NormalizedPresentation, sources: (PositionRef | null | undefined)[]): Position {
	for (const src of sources) {
		if (!src) continue;
		const pos = resolve(p, src);
		if (pos) return pos;
	}
	return { slide: 0, state: 0 };
}

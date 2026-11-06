import type { NormalizedPresentation, PositionRef } from './types';

function decode(s: string): string | null {
	try { return decodeURIComponent(s); } catch { return null; }
}

/** Matches by name first, else as a 1-based index. Returns a 0-based index or -1. */
function lookup(seg: string, names: (string | undefined)[]): number {
	const byName = names.findIndex((n) => n === seg);
	if (byName >= 0) return byName;
	if (!/^\d+$/.test(seg)) return -1;
	const n = Number(seg);
	return n >= 1 && n <= names.length ? n - 1 : -1;
}

export function parseHash(hash: string, p: NormalizedPresentation): PositionRef | null {
	const segs = hash.replace(/^#/, '').split('/').map(decode);
	if (segs.length < 2 || segs.length > 3 || segs.some((s) => s === null || s === '')) return null;
	const [name, slideSeg, stateSeg] = segs as string[];
	if (name !== p.name) return null;
	const slide = lookup(slideSeg, p.slides.map((s) => s.name));
	if (slide < 0) return null;
	if (stateSeg === undefined) return { slide };
	const state = lookup(stateSeg, p.slides[slide].states.map((s) => s.name));
	return state < 0 ? null : { slide, state };
}

import type { NormalizedPresentation, Position, PositionRef } from './types';

/** The minimal Storage surface used here, so tests can pass a plain object. */
export type PositionStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** One key per page and presentation, so two decks (or one deck embedded in two posts) don't share a position. */
export function storageKey(p: NormalizedPresentation, path: string): string {
	return `presentation:${path}:${p.name}`;
}

/**
 * Stores the position by slide/state name where there is one, else by 0-based index,
 * so that inserting slides or states doesn't shift a saved named position.
 * Storage errors (private mode, quota, blocked site data) are ignored.
 */
export function savePosition(storage: PositionStorage | null, key: string, p: NormalizedPresentation, pos: Position): void {
	const slide = p.slides[pos.slide];
	if (!slide) return;
	const ref: PositionRef = { slide: slide.name ?? pos.slide, state: slide.states[pos.state]?.name ?? pos.state };
	try { storage?.setItem(key, JSON.stringify(ref)); } catch { /* unavailable */ }
}

/** The saved reference if it is well-formed; `initialPosition` still resolves (and may reject) it. */
export function loadPosition(storage: PositionStorage | null, key: string): PositionRef | null {
	let raw: string | null = null;
	try { raw = storage?.getItem(key) ?? null; } catch { return null; }
	if (!raw) return null;
	try {
		const v = JSON.parse(raw);
		const ok = (x: unknown) => typeof x === 'string' || (typeof x === 'number' && Number.isInteger(x));
		return v && typeof v === 'object' && ok(v.slide) && ok(v.state) ? { slide: v.slide, state: v.state } : null;
	} catch {
		return null;
	}
}

/** `localStorage`, or null where reading it throws. */
export function pageStorage(): PositionStorage | null {
	try { return window.localStorage; } catch { return null; }
}

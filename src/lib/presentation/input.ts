import type { Position } from './types';

export type Command = 'next' | 'prev' | 'first' | 'last' | 'grid' | 'fullscreen' | 'escape';

export function keyCommand(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Command | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	switch (e.key) {
		case 'ArrowLeft':
		case 'PageUp': return 'prev';
		case 'ArrowRight':
		case 'PageDown': return 'next';
		case ' ': return e.shiftKey ? 'prev' : 'next';
		case 'Home': return 'first';
		case 'End': return 'last';
		case 'g':
		case 'G': return 'grid';
		case 'f':
		case 'F': return 'fullscreen';
		case 'Escape': return 'escape';
		default: return null;
	}
}

export function swipeCommand(dx: number, dy: number, ms: number): 'next' | 'prev' | null {
	const ax = Math.abs(dx);
	if (ax < 50 || ax <= 1.5 * Math.abs(dy) || ms > 800) return null;
	return dx < 0 ? 'next' : 'prev';
}

export function gridMove(sel: Position, key: string, rows: number[]): Position | null {
	const len = rows[sel.slide] ?? 0;
	switch (key) {
		case 'ArrowLeft': return sel.state > 0 ? { slide: sel.slide, state: sel.state - 1 } : null;
		case 'ArrowRight': return sel.state < len - 1 ? { slide: sel.slide, state: sel.state + 1 } : null;
		case 'ArrowUp':
		case 'ArrowDown': {
			const slide = sel.slide + (key === 'ArrowUp' ? -1 : 1);
			if (slide < 0 || slide >= rows.length) return null;
			return { slide, state: Math.min(sel.state, Math.max(0, rows[slide] - 1)) };
		}
		default: return null;
	}
}

import type { PhotoAction } from './photo-keys';

export const SWIPE_MIN_PX = 40;
export type SwipeDir = 'left' | 'right' | 'up' | 'down';

/** The swipe direction for a pointer travel of (dx, dy): the dominant axis, at least SWIPE_MIN_PX along it; null otherwise. */
export function swipeDir(dx: number, dy: number): SwipeDir | null {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (ax === ay) return null;
	if (ax > ay) return ax >= SWIPE_MIN_PX ? (dx > 0 ? 'right' : 'left') : null;
	return ay >= SWIPE_MIN_PX ? (dy > 0 ? 'down' : 'up') : null;
}

/** Swipes act like the arrow keys: swiping left brings the next photo, swiping up the next burst. */
export function swipeAction(dir: SwipeDir | null): PhotoAction | null {
	switch (dir) {
		case 'left':
			return { kind: 'item', delta: 1 };
		case 'right':
			return { kind: 'item', delta: -1 };
		case 'up':
			return { kind: 'burst', delta: 1 };
		case 'down':
			return { kind: 'burst', delta: -1 };
		default:
			return null;
	}
}

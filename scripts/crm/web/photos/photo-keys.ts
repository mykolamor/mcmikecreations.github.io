/** What a key or swipe asks the photo viewer to do: move within the burst (item), between bursts, or select/unselect. */
export type PhotoAction = { kind: 'item'; delta: 1 | -1 } | { kind: 'burst'; delta: 1 | -1 } | { kind: 'toggle' };

type KeyLike = { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
type TargetLike = { tagName?: string; isContentEditable?: boolean; dataset?: { photoNav?: string } } | null;

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Keyboard accelerators of the Photos tab: ←/→ within the burst, ↑/↓ between bursts, Space selects. Ignored while typing
 * in a field (or an editable element) and with modifiers; Space on a button is left to the button, except on photo
 * navigation buttons (`data-photo-nav`: burst grid, filmstrip), where re-clicking would only re-pick the same photo.
 */
export function photoKey(e: KeyLike, target: TargetLike): PhotoAction | null {
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
	const tag = target?.tagName?.toUpperCase() ?? '';
	if (FIELDS.has(tag) || target?.isContentEditable) return null;
	switch (e.key) {
		case 'ArrowRight':
			return { kind: 'item', delta: 1 };
		case 'ArrowLeft':
			return { kind: 'item', delta: -1 };
		case 'ArrowDown':
			return { kind: 'burst', delta: 1 };
		case 'ArrowUp':
			return { kind: 'burst', delta: -1 };
		case ' ':
		case 'Spacebar':
			return tag === 'BUTTON' && target?.dataset?.photoNav === undefined ? null : { kind: 'toggle' };
		default:
			return null;
	}
}

/**
 * Firefox may click a focused button on Space keyup even when keydown was prevented. On photo navigation buttons Space
 * already selected on keydown, so its keyup must be prevented too (true = call preventDefault).
 */
export function swallowNavSpaceKeyup(e: KeyLike, target: TargetLike): boolean {
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
	if (e.key !== ' ' && e.key !== 'Spacebar') return false;
	return target?.tagName?.toUpperCase() === 'BUTTON' && target.dataset?.photoNav !== undefined;
}

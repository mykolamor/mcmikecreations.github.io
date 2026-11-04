export type ListKeyResult = { active: number; choose: boolean; prevent: boolean };

/** Keyboard reducer for the inspect list. Keys from a button inside a row are left to the button (Enter must not also add a node). */
export function listKey(key: string, fromButton: boolean, active: number, count: number): ListKeyResult {
	const same = { active, choose: false, prevent: false };
	if (!count || fromButton) return same;
	if (key === 'ArrowDown') return { active: Math.min(count - 1, active + 1), choose: false, prevent: true };
	if (key === 'ArrowUp') return { active: Math.max(0, active - 1), choose: false, prevent: true };
	if (key === 'Enter') return { active, choose: true, prevent: true };
	return same;
}

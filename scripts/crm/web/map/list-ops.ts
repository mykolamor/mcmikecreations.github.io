/** Pure list edits for the checkpoint and node lists. A no-op returns the same array so callers can skip the save. */
export function moveItem<T>(list: T[], i: number, delta: -1 | 1): T[] {
	return moveTo(list, i, i + delta);
}

export function moveTo<T>(list: T[], from: number, to: number): T[] {
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

export function removeAt<T>(list: T[], i: number): T[] {
	return i < 0 || i >= list.length ? list : list.filter((_, j) => j !== i);
}

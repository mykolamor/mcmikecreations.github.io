export function mountWindow(current: number, count: number): number[] {
	return [current - 1, current, current + 1].filter((i) => i >= 0 && i < count);
}

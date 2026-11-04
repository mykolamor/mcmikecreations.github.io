export type BaseDef<T = unknown> = { id: string; label: string; layer: T | null; disabledNote?: string };

/** Remembered choice if still usable, else Tracestrack when it has a key, else Mapy. */
export function pickBase<T>(defs: BaseDef<T>[], saved: string | null): BaseDef<T> {
	const usable = defs.filter((d) => d.layer);
	return usable.find((d) => d.id === saved) ?? usable.find((d) => d.id === 'tracestrack') ?? usable.find((d) => d.id === 'mapy')!;
}

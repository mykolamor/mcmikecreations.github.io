/** Joins class values like clsx (strings, numbers, arrays, `{ class: condition }` objects), which flowbite uses but this site doesn't depend on. */
export function cx(...values: unknown[]): string {
	const out: string[] = [];
	const add = (v: unknown): void => {
		if (!v) return;
		if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
		else if (Array.isArray(v)) v.forEach(add);
		else if (typeof v === 'object') for (const [k, on] of Object.entries(v)) if (on) out.push(k);
	};
	values.forEach(add);
	return out.join(' ');
}

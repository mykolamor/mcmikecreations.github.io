/** Types digits and auto-inserts dashes: `20240` -> `2024-0`. Keeps at most 8 digits. */
export function maskDate(input: string): string {
	const d = input.replace(/\D/g, '').slice(0, 8);
	if (d.length <= 4) return d;
	if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
	return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

export function isValidDate(s: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return false;
	const [y, mo, d] = [+m[1], +m[2], +m[3]];
	const dt = new Date(Date.UTC(y, mo - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const pad = (n: number) => String(n).padStart(2, '0');

/** Weeks (Monday first) of a month; cells outside the month are null. `month` is 1-12. */
export function monthGrid(year: number, month: number): (string | null)[][] {
	const first = new Date(Date.UTC(year, month - 1, 1));
	const lead = (first.getUTCDay() + 6) % 7;
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const cells: (string | null)[] = Array(lead).fill(null);
	for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
	while (cells.length % 7) cells.push(null);
	const weeks: (string | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const i = year * 12 + (month - 1) + delta;
	return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** The local calendar day of `d`, `YYYY-MM-DD` (a "Today" stamp). */
export const localDate = (d = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

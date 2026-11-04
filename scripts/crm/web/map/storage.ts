/** localStorage wrappers that never throw (private windows, blocked storage). */
export function readPref(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
export function writePref(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* not remembered */
	}
}

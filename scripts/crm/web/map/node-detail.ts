// Logic of the node editor: local tags <-> editable rows, the PATCH body, and the redundant keys offered after a refresh.
export type Local = Record<string, string | null>;
export type Row = { key: string; value: string };

/** Editable rows for the local tags (null shows as an empty value); `visited` has its own select. */
export function rowsOf(local: Local | undefined): { rows: Row[]; visited: string } {
	const rows: Row[] = [];
	let visited = '';
	for (const [key, value] of Object.entries(local ?? {})) {
		if (key === 'visited') visited = value ?? '';
		else rows.push({ key, value: value ?? '' });
	}
	return { rows, visited };
}

/**
 * The `local` object to PATCH (the server replaces `local` as a whole): blank keys dropped, an empty value becomes null
 * (hides the OSM tag), `visited` from its select. Null when nothing changed, so no request is needed.
 */
export function localPatch(original: Local | undefined, rows: Row[], visited: string): Local | null {
	const next: Local = {};
	for (const r of rows) {
		const key = r.key.trim();
		if (key && key !== 'visited') next[key] = r.value === '' ? null : r.value;
	}
	if (visited) next.visited = visited;
	return JSON.stringify(sorted(next)) === JSON.stringify(sorted(original ?? {})) ? null : next;
}

const sorted = (o: Local): [string, string | null][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Redundant local keys (now equal to OSM) that are still in the local tags. */
export function redundantOffers(result: { redundantLocal: string[] }, local: Local | undefined): string[] {
	return result.redundantLocal.filter((k) => local !== undefined && k in local);
}

export function dropKeys(local: Local | undefined, keys: string[]): Local {
	return Object.fromEntries(Object.entries(local ?? {}).filter(([k]) => !keys.includes(k)));
}

/**
 * After a refresh the server's `local` is the base (it may hold keys added elsewhere since load); the user's unsaved edits
 * (keys whose value differs from what was loaded, or that were removed) go on top by key. Blank new rows stay.
 */
export function mergeRefreshed(loaded: Local | undefined, rows: Row[], visited: string, server: Local | undefined): { rows: Row[]; visited: string } {
	const before = loaded ?? {};
	const mine: Local = {};
	for (const r of rows) {
		const key = r.key.trim();
		if (key && key !== 'visited') mine[key] = r.value === '' ? null : r.value;
	}
	if (visited) mine.visited = visited;
	const out: Local = { ...(server ?? {}) };
	for (const k of new Set([...Object.keys(before), ...Object.keys(mine)])) {
		if (k in mine ? !(k in before) || before[k] !== mine[k] : k in before) {
			if (k in mine) out[k] = mine[k];
			else delete out[k];
		}
	}
	const merged = rowsOf(out);
	return { rows: [...merged.rows, ...rows.filter((r) => !r.key.trim())], visited: merged.visited };
}

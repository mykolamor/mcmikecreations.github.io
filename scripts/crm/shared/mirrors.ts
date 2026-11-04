/** Mirror links (Komoot, Strava, …) are the `kind: mirror` entries of a post's `facts.sources`. */
/** `key` is the index of the source entry the row came from; new rows have none. */
export type MirrorRow = { title: string; url: string; key?: number };

export const DEFAULT_MIRRORS = ['Komoot', 'Strava', 'AllTrails'];

type Src = Record<string, unknown>;

/** Only plain string-titled mirror entries are editable rows; anything else is left alone. */
export function isMirror(s: unknown): s is { title: string; url: string; kind: 'mirror' } {
	const o = s as Src | null;
	return !!o && typeof o === 'object' && o.kind === 'mirror' && typeof o.title === 'string' && typeof o.url === 'string';
}

/** Existing mirror entries, then an empty row for each default that is missing. */
export function mirrorRows(sources: unknown): MirrorRow[] {
	const list = Array.isArray(sources) ? sources : [];
	const rows: MirrorRow[] = [];
	list.forEach((s, key) => {
		if (isMirror(s)) rows.push({ title: s.title, url: s.url, key });
	});
	for (const t of DEFAULT_MIRRORS) {
		if (!rows.some((r) => r.title.toLowerCase() === t.toLowerCase())) rows.push({ title: t, url: '' });
	}
	return rows;
}

/** Rows with a URL, in order, titled by their URL when the title is blank. */
function keptRows(rows: MirrorRow[]): MirrorRow[] {
	const out: MirrorRow[] = [];
	for (const r of rows) {
		const url = (r.url ?? '').trim();
		if (!url) continue;
		out.push({ title: (r.title ?? '').trim() || url, url, key: r.key });
	}
	return out;
}

export type PlanItem = { item: unknown; from: number | null };

/**
 * The new `sources` list with provenance. Each mirror entry is matched to its row by `key`: an
 * unchanged row keeps the very same object, an edited one keeps the original's extra keys, a
 * cleared one disappears. Non-mirror sources keep their place; rows without a matching entry
 * are appended.
 */
export function planMirrorRows(sources: unknown, rows: MirrorRow[]): PlanItem[] {
	const list = Array.isArray(sources) ? sources : [];
	const kept = keptRows(rows);
	// A key is trusted only while its entry still looks like the row (title or url unchanged);
	// otherwise the row is stale (indices shifted) and falls back to matching by content.
	const byKey = new Map<number, MirrorRow>();
	const rest: MirrorRow[] = [];
	for (const r of kept) {
		const e = r.key !== undefined ? list[r.key] : undefined;
		if (r.key !== undefined && isMirror(e) && !byKey.has(r.key) && (e.title === r.title || e.url === r.url)) byKey.set(r.key, r);
		else rest.push(r);
	}
	const fresh: MirrorRow[] = [];
	const claim = (r: MirrorRow, test: (e: { title: string; url: string }) => boolean) => {
		const i = list.findIndex((e, j) => isMirror(e) && !byKey.has(j) && test(e));
		if (i < 0) return false;
		byKey.set(i, r);
		return true;
	};
	for (const r of rest) if (!claim(r, (e) => e.title === r.title && e.url === r.url)) fresh.push(r);
	const rest2 = fresh.splice(0);
	for (const r of rest2) if (!claim(r, (e) => e.title === r.title)) fresh.push(r);
	const out: PlanItem[] = [];
	list.forEach((s, i) => {
		if (!isMirror(s)) return void out.push({ item: s, from: i });
		const r = byKey.get(i);
		if (!r) return;
		out.push({ item: r.title === s.title && r.url === s.url ? s : { ...s, title: r.title, url: r.url }, from: i });
	});
	for (const r of fresh) out.push({ item: { title: r.title, url: r.url, kind: 'mirror' }, from: null });
	return out;
}

export function applyMirrorRows(sources: unknown, rows: MirrorRow[]): unknown[] {
	return planMirrorRows(sources, rows).map((p) => p.item);
}

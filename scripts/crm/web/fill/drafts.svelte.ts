// The texts Fill put in, per open doc (or table, or shared record), in memory only: each is highlighted as a "DeepL
// draft" until the author edits it or the page reloads. Nothing marks them in the files.

let marked = $state.raw(new Map<string, ReadonlySet<string>>());

/** The drafts of one doc (`scope`, e.g. its query string), each a field id, a block's text or a path. */
export const drafts = {
	has(scope: string, id: string): boolean {
		return marked.get(scope)?.has(id) ?? false;
	},
	add(scope: string, ids: Iterable<string>): void {
		const next = new Set(marked.get(scope));
		for (const id of ids) next.add(id);
		marked = new Map(marked).set(scope, next);
	},
	/** The author edited it: no longer a draft. */
	clear(scope: string, id: string): void {
		if (!drafts.has(scope, id)) return;
		const next = new Set(marked.get(scope));
		next.delete(id);
		marked = new Map(marked).set(scope, next);
	}
};

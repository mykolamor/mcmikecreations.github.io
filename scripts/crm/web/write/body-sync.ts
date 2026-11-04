/**
 * Keeps the Write editor's text and the doc session's body in step, free of
 * CodeMirror. The editor text is the truth while it has unsaved changes: a
 * newer body from the server replaces it only when the editor is clean; while
 * it is dirty, a server write that touched another part of the body is merged
 * in, and anything else becomes the session's conflict (banner: Copy my text,
 * Reload, Overwrite), never a silent replace.
 */
import type { createDocSession } from '../doc-session';

type Session = ReturnType<typeof createDocSession>;

/** The one span `a` and `b` differ in: `a[from, to)` became `b[from, to + b.length - a.length)`. */
function changedSpan(a: string, b: string): { from: number; to: number; insert: string } {
	let p = 0;
	const max = Math.min(a.length, b.length);
	while (p < max && a[p] === b[p]) p++;
	let q = 0;
	while (q < max - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
	return { from: p, to: a.length - q, insert: b.slice(p, b.length - q) };
}

/**
 * `mine` and `theirs` both started from `base`: their changes together, or
 * null when they touch the same place (or touch each other: two insertions at
 * one point have no right order), except for a server append at the very end:
 * that goes after mine.
 */
export function mergeBodies(base: string, mine: string, theirs: string): string | null {
	if (mine === base) return theirs;
	if (theirs === base) return mine;
	const m = changedSpan(base, mine);
	const t = changedSpan(base, theirs);
	// Lines the server appended (an upload's credit) go after my text, even when I was writing at the end too.
	// As the server appends: a text without a final newline gets one first (and the server's own break before its lines,
	// put there because `base` had none, isn't doubled), so the lines don't join my last paragraph.
	if (t.from === base.length && m.to === base.length) {
		const lines = base === '' || base.endsWith('\n') ? t.insert : t.insert.replace(/^\n/, '');
		return (mine === '' || mine.endsWith('\n') ? mine : mine + '\n') + lines;
	}
	const [first, second] = m.from <= t.from ? [m, t] : [t, m];
	if (first.to >= second.from) return null;
	return base.slice(0, first.from) + first.insert + base.slice(first.to, second.from) + second.insert + base.slice(second.to);
}

/**
 * Syncs the editor (`getText`/`setText`) with `session`: `changed()` after every
 * edit the author makes queues the body (800 ms debounce, as other text fields);
 * session changes are applied as described above. `setText` must not report back
 * through `changed()`. On creation the editor gets the unsaved text if the queue
 * still holds one (the tab was left meanwhile), else the server's.
 */
export function createBodySync(session: Session, getText: () => string, setText: (text: string) => void) {
	/** The server body the editor text started from; null until the doc has one. */
	let base: string | null = null;
	/** The server refused my text (a 400 drops the op): it stays mine, not clean, until I edit again or reload. */
	let refused = false;
	let discards = session.discards;

	function sync() {
		const server = session.doc?.body;
		if (typeof server !== 'string') return;
		if (base === null) {
			base = server;
			setText(session.unsavedBody() ?? server);
			return;
		}
		const text = getText();
		const unsaved = session.unsavedBody();
		if (discards !== session.discards) {
			discards = session.discards;
			refused = false;
		}
		if (unsaved === null && session.queue.status === 'error' && text !== base) refused = true;
		if (server === base) return;
		// Clean: nothing of mine is waiting or refused.
		if (unsaved === null && (text === base || !refused)) {
			refused = false;
			base = server;
			if (text !== server) setText(server);
			return;
		}
		// Dirty from here on.
		const echo = session.lastSent !== null && server === session.lastSent.text && session.doc?.version === session.lastSent.version;
		if (server === text || echo) {
			// my own save coming back, possibly older than what I've typed since
			base = server;
			return;
		}
		if (session.queue.status === 'conflict') return; // the banner decides
		const merged = mergeBodies(base, text, server);
		if (merged === null) {
			session.queue.markConflict(session.doc);
			return;
		}
		base = server;
		if (merged !== text) setText(merged);
		// The queued text predates the server's change: replace it, or it would undo that change.
		session.edit({ kind: 'body', text: merged }, true);
	}

	const off = session.subscribe(sync);
	sync();
	return {
		/** The author edited the text. */
		changed() {
			if (base === null) return;
			refused = false;
			session.edit({ kind: 'body', text: getText() }, true);
		},
		destroy() {
			off();
		}
	};
}

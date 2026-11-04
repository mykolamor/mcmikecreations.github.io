/**
 * The translations of the open doc, one doc session per language, beside the English one: opened the first time the
 * Write tab switches to that language, created on "Translate into …", closed with the doc. Framework-free.
 */
import { api, ApiClientError } from '../api';
import { createDocSession, refSearch } from '../doc-session';
import type { SourceRef } from '../../server/doc-ref';
import type { Lang } from '$lib/i18n/languages';

type Session = ReturnType<typeof createDocSession>;
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** A normal doc session on `source`'s translation into `lang`; not loaded yet. */
export function translationSession(source: SourceRef, lang: Lang, opts: { request?: Request } = {}): Session {
	return createDocSession({ kind: 'translation', source, lang }, opts);
}

/** The language's English name, as "Translate into German" says it. */
export function languageName(lang: string): string {
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang.toUpperCase();
	} catch {
		return lang.toUpperCase();
	}
}

/**
 * The open doc's translation sessions. `open` makes and loads a language's session once (later calls return it);
 * `subscribe` hears when one is opened (or all are closed), not their edits: those are the session's own.
 */
export function createTranslations(source: SourceRef, opts: { request?: Request } = {}) {
	const request: Request = opts.request ?? api;
	const sessions = new Map<Lang, { session: Session; loading: Promise<void> }>();
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((l) => l());

	const t = {
		/** The language's session if it was opened, else null. */
		get(lang: Lang): Session | null {
			return sessions.get(lang)?.session ?? null;
		},
		/** Every session opened so far: the banner, the freshness check, Save and leaving the page look at each. */
		all(): Session[] {
			return [...sessions.values()].map((e) => e.session);
		},
		/** The language's session, made and loaded the first time. */
		open(lang: Lang): Session {
			const cur = sessions.get(lang);
			if (cur) return cur.session;
			const session = translationSession(source, lang, { request });
			sessions.set(lang, { session, loading: session.load() });
			notify();
			return session;
		},
		/** The first load of an opened language (rejects as it did); resolves at once for one not opened. */
		loaded(lang: Lang): Promise<void> {
			return sessions.get(lang)?.loading ?? Promise.resolve();
		},
		/**
		 * Writes the empty translation file (`---\n---\n`) and reads it into the language's session. One made meanwhile
		 * (409: elsewhere, or another tab) is read as it is.
		 */
		async create(lang: Lang): Promise<void> {
			const session = t.open(lang);
			try {
				await request('POST', `/api/translation/create?${refSearch(session.ref)}`);
			} catch (e) {
				if (!(e instanceof ApiClientError && e.status === 409)) throw e;
			}
			const entry = sessions.get(lang)!;
			entry.loading = session.load();
			await entry.loading;
		},
		subscribe(fn: () => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** The doc closed: its translations go with it. */
		close() {
			sessions.clear();
			notify();
			listeners.clear();
		}
	};
	return t;
}

export type Translations = ReturnType<typeof createTranslations>;

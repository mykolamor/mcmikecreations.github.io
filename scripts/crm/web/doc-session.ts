import { api, ApiClientError, ownWrites, upload as uploadRaw } from './api';
import { createSaveQueue } from './save-queue';
import type { FieldOp } from '../shared/ops';
import type { DocRef, EnglishRef } from '../server/doc-ref';

/**
 * The server's client doc. A place doc has no date, mirrors, files or facts (absent, not null); a translation has no
 * slug either, and says whether its file `exists`.
 */
export type ClientDocState = {
	kind?: DocRef['kind'];
	slug?: string;
	exists?: boolean;
	date?: string | null;
	version: string;
	fields: Record<string, unknown>;
	/** Every language of each translated field (a hike's or post's doc only). */
	texts?: Record<string, Record<string, string>>;
	mirrors?: unknown[];
	files?: unknown;
	body?: string | null;
	/** The raw authored `facts` of the sidecar (`hike`) and the post. */
	facts?: { hike: unknown | null; post: unknown | null };
	/**
	 * The version of the other files the views read (the route's GPX and GeoJSON, bailouts, the OSM store, the facts
	 * library); a hike's or post's doc only. A view that reads them keys on it.
	 */
	deps?: string;
};

type Patched = {
	version: string;
	fields: Record<string, unknown>;
	texts?: ClientDocState['texts'];
	mirrors: unknown[];
	body?: string | null;
	facts?: ClientDocState['facts'];
};
type UploadFn = <T>(path: string, file: File) => Promise<T>;
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export const isBody = (op: FieldOp): op is Extract<FieldOp, { kind: 'body' }> => 'kind' in op && op.kind === 'body';

export const RELOADED_NOTICE = 'Changed elsewhere — reloaded';
export const DEPS_RELOADED_NOTICE = 'Route or shared files changed elsewhere — reloaded';

/**
 * The query params naming a doc, as the server's refFromQuery reads them: `place=`, or `slug=` (+ `date=` for a post);
 * a translation's are its source's and `lang=`.
 */
export function refParams(ref: DocRef): Record<string, string> {
	if (ref.kind === 'translation') return { ...refParams(ref.source), lang: ref.lang };
	if (ref.kind === 'place') return { place: ref.slug };
	return ref.kind === 'post' ? { slug: ref.slug, date: ref.date } : { slug: ref.slug };
}

/** The address bar of an open doc (`?place=`, `?slug&date`, `?slug`), so a reload reopens it. */
export const refSearch = (ref: DocRef): string => new URLSearchParams(refParams(ref)).toString();

/**
 * The doc the address bar names; null on the Open screen. The server validates the values. A translation is never
 * opened on its own (the Write tab opens it beside its source), so `lang=` is not read.
 */
export function refFromSearch(q: URLSearchParams): EnglishRef | null {
	const place = q.get('place');
	if (place) return { kind: 'place', slug: place };
	const slug = q.get('slug');
	if (!slug) return null;
	const date = q.get('date');
	return date ? { kind: 'post', slug, date } : { kind: 'hike', slug };
}

/** One open doc (a post, a hike's sidecar or a place doc): the current server doc, its base version and the save queue. Framework-free. */
export function createDocSession(ref: DocRef, opts: { request?: Request; upload?: UploadFn } = {}) {
	const request: Request = opts.request ?? api;
	const doUpload: UploadFn = opts.upload ?? uploadRaw;
	// A translation's slug and date are its source's.
	const src = ref.kind === 'translation' ? ref.source : ref;
	const { slug } = src;
	const date = src.kind === 'post' ? src.date : null;
	const url = `/api/doc?${refSearch(ref)}`;
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((l) => l());
	let base = '';
	let loading: Promise<void> | null = null;
	let sendGen = 0;
	let inFlight = false;
	/** `ownWrites.count` when the doc's `deps` were last taken: a change since then may be this page's own. */
	let depsWrites = ownWrites.count;

	// A function, not a property read: TypeScript would keep a `queue.status` check narrowed across the awaits in between.
	const conflicted = (): boolean => queue.status === 'conflict';
	/**
	 * The conflict doc of a 409. One without `body` or `facts` (a route that doesn't send them) would keep the ones I
	 * loaded, and Overwrite would then save over an edit made elsewhere: the doc is re-read instead. If that fails too,
	 * the version is left empty, so Overwrite's save is refused again and its 409 brings them.
	 */
	const conflictDocOf = async (e: ApiClientError): Promise<ClientDocState> => {
		const d = { ...s.doc!, ...(e.body as Patched) };
		const lacks = (key: 'body' | 'facts') => !(key in (e.body as object)) && s.doc?.[key] != null;
		if (!lacks('body') && !lacks('facts')) return d;
		try {
			return (await request<{ doc: ClientDocState }>('GET', url)).doc;
		} catch {
			return { ...d, version: '' };
		}
	};
	const queue = createSaveQueue({
		send: async (ops) => {
			// Edits made before the first load wait for a real base version.
			if (!loading) throw new Error('Document not loaded yet');
			await loading;
			sendGen++;
			inFlight = true;
			try {
				const r = await request<Patched>('PATCH', url, { base, ops });
				sendGen++;
				base = r.version;
				const sent = ops.find(isBody);
				if (sent) s.lastSent = { text: sent.text, version: r.version };
				s.doc = { ...s.doc!, ...r };
				return { conflict: false };
			} catch (e) {
				sendGen++;
				if (e instanceof ApiClientError && e.status === 409 && e.body) {
					return { conflict: true, doc: await conflictDocOf(e) };
				}
				throw e;
			} finally {
				inFlight = false;
			}
		}
	});
	queue.subscribe(notify);

	const s = {
		slug,
		date,
		/** Which doc this is; photo routes build their query from it. */
		ref,
		doc: null as ClientDocState | null,
		notice: null as string | null,
		/** The body text of the last successful save and the version it made: its echo in `doc.body` is not a change made elsewhere. */
		lastSent: null as { text: string; version: string } | null,
		/** Counts "Reload (discard my unsaved)": the editor drops what it kept of mine. */
		discards: 0,
		/** Counts Overwrite: a view drops an edit it holds by its old text, which the conflict showed it can't find. */
		overwrites: 0,
		/**
		 * Counts the doc replaced by a version this view didn't save (a freshness reload, "Reload (discard my unsaved)"):
		 * a view drops what it keeps by position in the old one, such as a selected list entry.
		 */
		reloads: 0,
		queue,
		subscribe(fn: () => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		load(): Promise<void> {
			const gen = sendGen;
			loading = (async () => {
				const r = await request<{ doc: ClientDocState }>('GET', url);
				// A re-read that raced a save may predate it: keep what the save answered.
				if (s.doc && (gen !== sendGen || inFlight)) return;
				s.doc = r.doc;
				base = r.doc.version;
				depsWrites = ownWrites.count;
				notify();
			})();
			return loading;
		},
		edit(op: FieldOp, debounce: boolean) {
			queue.queue(op, { debounce });
		},
		/** The body text queued but not saved yet (the Write editor's), for "Copy my text" and for a Write tab opened again. */
		unsavedBody(): string | null {
			return queue.pending().find(isBody)?.text ?? null;
		},
		clearNotice() {
			s.notice = null;
			notify();
		},
		/**
		 * Runs a server write that changes the doc (an upload, a metrics recompute) under the version protocol: flushes pending
		 * edits first, refuses while a conflict is open, sends the base version and pauses the queue meanwhile. 409 goes through
		 * the conflict path. On success the doc takes the response's `version` (and `fields` when present).
		 */
		async guardedWrite<T extends { version: string; fields?: Record<string, unknown> }>(call: (base: string) => Promise<T>): Promise<T> {
			if (!loading) throw new Error('Document not loaded yet');
			await loading;
			if (conflicted()) throw new Error('Resolve the conflict first (reload or overwrite), then continue');
			await queue.flush();
			await queue.idle();
			if (conflicted()) throw new Error('Resolve the conflict first (reload or overwrite), then continue');
			if (base === '') {
				void s.checkFresh().catch(() => {});
				throw new Error('Couldn’t confirm the latest version — reload the doc');
			}
			if (queue.status === 'error') throw new Error('Pending edits could not be saved; fix that first');
			const sent = base;
			queue.pause();
			sendGen++;
			inFlight = true;
			try {
				const r = await call(sent);
				sendGen++;
				// paused, so nothing else was sent: the server checked `sent` under its lock and r.version directly succeeds it
				base = r.version;
				let next: ClientDocState = { ...s.doc!, version: r.version, ...(r.fields ? { fields: r.fields } : {}) };
				// The write may have changed the body too (an upload's credit lines, a caption). Re-read it while the queue
				// is still paused, so a body edit typed meanwhile is merged with it before it is sent on the new version.
				if (typeof next.body === 'string' && !('body' in r)) {
					try {
						const g = await request<{ doc: ClientDocState }>('GET', url);
						if (g.doc.version === r.version) next = g.doc;
					} catch {
						// The body on disk is unknown: an empty base makes the next save a 409 (the conflict banner), refuses
						// guarded writes and has the freshness check (right after this write) re-read the doc, instead of a
						// stale body being saved over the write.
						base = '';
					}
				} else if ('body' in r) next.body = (r as { body?: string | null }).body;
				s.doc = next;
				notify();
				return r;
			} catch (e) {
				sendGen++;
				if (e instanceof ApiClientError && e.status === 409 && e.body) {
					queue.markConflict(await conflictDocOf(e));
					throw new Error('Changed on disk — see the conflict banner');
				}
				throw e;
			} finally {
				inFlight = false;
				queue.resume();
				if (base === '') void s.checkFresh().catch(() => {});
			}
		},
		/** Uploads `file` to a /api/files/* route (`query` holds the route's own params, e.g. scope), via `guardedWrite`. */
		async uploadFile(route: string, query: Record<string, string>, file: File): Promise<void> {
			const r = await s.guardedWrite((sent) => {
				const params = new URLSearchParams({ slug, ...(date ? { date } : {}), ...query, base: sent });
				return doUpload<{ files: unknown; version: string }>(`/api/files/${route}?${params}`, file);
			});
			s.doc = { ...s.doc!, files: r.files };
			notify();
		},
		/** Recomputes distance/ascent/descent/duration from the GPX into front matter, via `guardedWrite`. */
		async recomputeMetrics(): Promise<void> {
			await s.guardedWrite((sent) => {
				const params = new URLSearchParams({ slug, ...(date ? { date } : {}), base: sent });
				return request<{ version: string; fields: Record<string, unknown> }>('POST', `/api/metrics/recompute?${params}`);
			});
		},
		/** Replaces the files state after a server action that changed files without touching the doc (thumbnail rebuild). */
		setFiles(files: unknown) {
			s.doc = { ...s.doc!, files };
			notify();
		},
		/** Detects an on-disk change made elsewhere (IDE, other device) while this view sat idle. */
		async checkFresh(): Promise<void> {
			if (!loading || inFlight || conflicted()) return;
			const gen = sendGen;
			const r = await request<{ doc: ClientDocState }>('GET', url);
			// A save started or finished meanwhile: this GET may predate it.
			if (gen !== sendGen || inFlight || conflicted()) return;
			if (r.doc.version === base) {
				// The doc is as I have it, but a file its views read changed: take the new `deps` and `files` only (my
				// pending edits stay). Said only when this page wrote nothing since (an OSM or facts library save, an upload).
				if (r.doc.deps === undefined || r.doc.deps === s.doc?.deps) return;
				const mine = ownWrites.count !== depsWrites;
				depsWrites = ownWrites.count;
				s.doc = { ...s.doc!, deps: r.doc.deps, files: r.doc.files };
				if (!mine) s.notice = DEPS_RELOADED_NOTICE;
				notify();
				return;
			}
			if (queue.pending().length > 0) {
				queue.markConflict(r.doc);
				return;
			}
			s.doc = r.doc;
			base = r.doc.version;
			depsWrites = ownWrites.count;
			s.reloads++;
			s.notice = RELOADED_NOTICE;
			notify();
		},
		/** Drop unsaved edits and show what is on disk; then re-reads the doc so `files` is fresh too. */
		async reloadDiscarding(): Promise<void> {
			const d = queue.conflictDoc as ClientDocState | null;
			if (!d) return;
			queue.resolve('discard');
			s.discards++;
			s.reloads++;
			s.doc = d;
			base = d.version;
			notify();
			const gen = sendGen;
			try {
				const r = await request<{ doc: ClientDocState }>('GET', url);
				if (gen !== sendGen || inFlight || conflicted() || queue.pending().length > 0) return;
				s.doc = r.doc;
				base = r.doc.version;
				notify();
			} catch {
				/* the conflict doc is already shown */
			}
		},
		/** Keep my edits and write them over the newer disk version. */
		overwrite() {
			const d = queue.conflictDoc as ClientDocState | null;
			if (!d) return;
			base = d.version;
			// Take the whole conflict doc, my pending values on top.
			const fields = { ...d.fields };
			const texts = { ...d.texts };
			let mirrors = d.mirrors;
			let body = d.body;
			for (const op of queue.pending()) {
				if ('kind' in op) {
					if (op.kind === 'mirrors') mirrors = op.rows;
					else if (op.kind === 'body') body = op.text;
					// A facts op stays queued as it is: `facts` shows the conflict doc's until it is saved.
				} else if (op.lang) {
					// A translated text of another language: `texts` only, `fields` keeps the English.
					const next = { ...texts[op.field] };
					if (typeof op.value === 'string' && op.value.trim()) next[op.lang] = op.value;
					else delete next[op.lang];
					texts[op.field] = next;
				} else if (op.field.startsWith('map.')) {
					const cur = (fields[op.field] ?? {}) as { hike?: unknown; post?: unknown };
					const scope = op.scope === 'post' ? 'post' : 'hike';
					const next = { ...cur };
					if (op.value === null || op.value === undefined) delete next[scope];
					else next[scope] = op.value;
					fields[op.field] = next;
				} else {
					fields[op.field] = op.value;
					if (texts[op.field]) texts[op.field] = { ...texts[op.field], en: String(op.value ?? '') };
				}
			}
			s.doc = { ...d, fields, ...(d.texts ? { texts } : {}), mirrors, body };
			s.overwrites++;
			notify();
			queue.resolve('overwrite');
		}
	};
	return s;
}

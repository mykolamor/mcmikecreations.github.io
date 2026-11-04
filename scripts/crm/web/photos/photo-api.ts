import { api, ApiClientError, upload } from '../api';
import { isValidDate } from '../date-utils';
import { refParams, type createDocSession } from '../doc-session';
import type { DocRef } from '../../server/doc-ref';

export { refParams };

type Session = ReturnType<typeof createDocSession>;
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** The open doc's params, plus `extra` params. */
export function docQuery(session: Pick<Session, 'ref'>, extra: Record<string, string> = {}): string {
	return new URLSearchParams({ ...refParams(session.ref), ...extra }).toString();
}

/**
 * `/api/photos/candidates` params: a post picks an album, a place doc a smart-search text (blank: the server uses
 * the title); the date range goes along only when both ends are valid dates.
 */
export function candidatesQuery(ref: DocRef, src: { album: string; query: string; from: string; to: string }): string {
	const extra: Record<string, string> = ref.kind === 'place' ? (src.query.trim() ? { query: src.query.trim() } : {}) : { album: src.album };
	if (isValidDate(src.from) && isValidDate(src.to)) Object.assign(extra, { from: src.from, to: src.to });
	return new URLSearchParams({ ...refParams(ref), ...extra }).toString();
}

/** A 409 without a doc version is a refusal (used in the text), not a stale base: an ordinary error, no conflict banner. */
function refusal(e: unknown): unknown {
	if (e instanceof ApiClientError && e.status === 409 && typeof (e.body as { version?: unknown } | null)?.version !== 'string') return new Error(e.message);
	return e;
}

/**
 * A photo write under the doc's version protocol (session.guardedWrite): `base` goes into the JSON body, or into the
 * query for bodiless requests (DELETE). A stale base raises the conflict banner; other errors are thrown as they are.
 */
export function photoWrite<T extends { version: string }>(session: Session, method: string, path: string, body?: Record<string, unknown>, request: Request = api): Promise<T> {
	return session.guardedWrite(async (base) => {
		try {
			if (body === undefined) return await request<T>(method, `${path}?${docQuery(session, { base })}`);
			return await request<T>(method, `${path}?${docQuery(session)}`, { ...body, base });
		} catch (e) {
			throw refusal(e);
		}
	});
}

/** Uploads a photo file (raw body) under the version protocol. */
export function photoUpload<T extends { version: string }>(session: Session, query: Record<string, string>, file: File): Promise<T> {
	return session.guardedWrite(async (base) => {
		try {
			return await upload<T>(`/api/photos/upload?${docQuery(session, { ...query, base })}`, file);
		} catch (e) {
			throw refusal(e);
		}
	});
}

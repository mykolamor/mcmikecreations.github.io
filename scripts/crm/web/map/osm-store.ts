// Client side of the shared OSM store (osm.json) writes, with the version protocol.
import { ApiClientError, api } from '../api';

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;
export type Entry = { lat: number; lon: number; demEle?: number; tags?: Record<string, string>; local?: Record<string, string | null>; fetched?: string };
export type RefreshResult = { version: string; entry: Entry; diff: { added: Record<string, string>; removed: Record<string, string>; changed: Record<string, { from: string; to: string }> }; redundantLocal: string[] };

/** A local-tag save met a newer osm.json; the caller reloads instead of retrying. */
export class StoreChangedError extends Error {
	constructor(public version: string) {
		super('osm.json changed elsewhere');
	}
}

const staleVersion = (e: unknown): string | null => (e instanceof ApiClientError && e.status === 409 ? ((e.body as { version?: string } | undefined)?.version ?? null) : null);

export async function storeVersion(request: Request = api): Promise<string> {
	return (await request<{ version: string }>('GET', '/api/osm/store/version')).version;
}

export async function loadEntry(ref: string, request: Request = api): Promise<{ version: string; entry: Entry }> {
	return request('GET', `/api/osm/entry?${new URLSearchParams({ ref })}`);
}

/** POSTs with the current store version; a stale one is retried once with the version the server returned. */
async function writeRetrying<T>(path: string, body: Record<string, unknown>, request: Request): Promise<{ result: T; retried: boolean }> {
	const first = await storeVersion(request);
	try {
		return { result: await request<T>('POST', path, { ...body, base: first }), retried: false };
	} catch (e) {
		const v = staleVersion(e);
		if (!v) throw e;
		return { result: await request<T>('POST', path, { ...body, base: v }), retried: true };
	}
}

/** Adds a ref to the store. Returns whether the store changed meanwhile and the write was retried. */
export async function addRef(ref: string, request: Request = api): Promise<boolean> {
	return (await writeRetrying('/api/osm/add', { refs: [ref] }, request)).retried;
}

export async function refreshRef(ref: string, request: Request = api): Promise<{ result: RefreshResult; retried: boolean }> {
	return writeRetrying<RefreshResult>('/api/osm/refresh', { ref }, request);
}

/** Saves the whole `local` object under the version the editor loaded; a stale version is not retried (the author's edit may conflict). */
export async function saveLocal(ref: string, local: Record<string, string | null>, base: string, request: Request = api): Promise<{ version: string; entry: Entry }> {
	try {
		return await request('PATCH', '/api/osm/local', { ref, local, base });
	} catch (e) {
		const v = staleVersion(e);
		if (v) throw new StoreChangedError(v);
		throw e;
	}
}

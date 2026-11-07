// Keeps the tab dots current: reads the doc's gaps (and whether its photos have pins) when it opens and once a change has settled, whether this page's
// write (a doc, a translation or a shared record) or a doc reloaded from disk. Framework-free.
import { api, ownWrites } from './api';
import { refSearch } from './doc-session';
import type { EnglishRef } from '../server/doc-ref';
import type { Gaps } from '../shared/translation-gaps';

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/**
 * Reads `path` (with the doc's query) when the doc opens and once a change has settled, and hands the answer to `show`.
 * `versions` names the open docs' versions. `tick` is called once a second: a change seen on one tick is read on the
 * next one without a further change, so a write has landed and typing doesn't ask on every save.
 */
export function createDocWatch<T>(ref: EnglishRef, path: string, versions: () => string, show: (answer: T) => void, request: Request = api) {
	const key = () => `${ownWrites.count}|${versions()}`;
	let seen = key();
	let dirty = false;
	let gen = 0;
	const read = async () => {
		const mine = ++gen;
		try {
			const answer = await request<T>('GET', `${path}?${refSearch(ref)}`);
			if (mine === gen) show(answer);
		} catch {
			/* no mark rather than an error: the doc's own load and saves report a server that is down */
		}
	};
	void read();
	return {
		tick() {
			const now = key();
			if (now !== seen) {
				seen = now;
				dirty = true;
			} else if (dirty) {
				dirty = false;
				void read();
			}
		}
	};
}

/** The tab dots for what a translation lacks. */
export const createGapWatch = (ref: EnglishRef, versions: () => string, show: (gaps: Gaps) => void, request: Request = api) =>
	createDocWatch<{ gaps: Gaps }>(ref, '/api/translation-gaps', versions, (r) => show(r.gaps), request);

/** The Photos tab's dot: whether a photo of the doc has a pin. */
export const createPinsWatch = (ref: EnglishRef, versions: () => string, show: (hasPins: boolean) => void, request: Request = api) =>
	createDocWatch<{ hasPins: boolean }>(ref, '/api/photos/has-pins', versions, (r) => show(r.hasPins === true), request);

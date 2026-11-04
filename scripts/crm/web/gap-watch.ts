// Keeps the tab dots current: reads the doc's gaps when it opens and once a change has settled, whether this page's
// write (a doc, a translation or a shared record) or a doc reloaded from disk. Framework-free.
import { api, ownWrites } from './api';
import { refSearch } from './doc-session';
import type { EnglishRef } from '../server/doc-ref';
import type { Gaps } from '../shared/translation-gaps';

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/**
 * `versions` names the open docs' versions. `tick` is called once a second: a change seen on one tick is read on the
 * next one without a further change, so a write has landed and typing doesn't ask on every save.
 */
export function createGapWatch(ref: EnglishRef, versions: () => string, show: (gaps: Gaps) => void, request: Request = api) {
	const key = () => `${ownWrites.count}|${versions()}`;
	let seen = key();
	let dirty = false;
	let gen = 0;
	const read = async () => {
		const mine = ++gen;
		try {
			const { gaps } = await request<{ gaps: Gaps }>('GET', `/api/translation-gaps?${refSearch(ref)}`);
			if (mine === gen) show(gaps);
		} catch {
			/* no dots rather than an error: the doc's own load and saves report a server that is down */
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

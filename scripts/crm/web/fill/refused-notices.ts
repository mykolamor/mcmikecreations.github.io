// The texts Fill couldn't use, remembered in `localStorage` per surface until the author dismisses them or fills that
// surface again: a refused text is simply not filled, so nothing else in the doc says it is missing.
import type { Lang } from '$lib/i18n/languages';

export type RefusedText = { id: string; label: string; reason: string };
type NoticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A notice's key: `doc` is the doc's or table's scope, `surface` which of its Fill buttons. */
export const noticeKey = (doc: string, lang: Lang | string, surface: string): string => `crm.fillRefused:${doc}:${lang}:${surface}`;

/** The texts noted under `key`; none when there is no notice, it is damaged or the storage is blocked. */
export function readRefused(storage: NoticeStorage, key: string): RefusedText[] {
	try {
		const list: unknown = JSON.parse(storage.getItem(key) ?? '[]');
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

/** Notes `list` under `key`; an empty one removes the notice. A blocked storage only loses the note. */
export function writeRefused(storage: NoticeStorage, key: string, list: RefusedText[]): void {
	try {
		if (list.length) storage.setItem(key, JSON.stringify(list));
		else storage.removeItem(key);
	} catch {
		// the notice still shows until the page is left
	}
}

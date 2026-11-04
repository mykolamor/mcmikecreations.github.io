/** The CRM-wide second language, remembered per browser. */
export const LANG_KEY = 'crm.lang';
/** Where the Facts tab kept it before; still read, never removed. */
export const OLD_LANG_KEY = 'crm.factsLang';

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/**
 * The language shown beside English: the one stored under `crm.lang` while the site still has it, else the Facts tab's
 * old `crm.factsLang` (then stored under `crm.lang`), else the first other language; null when the site has English
 * only. Storage that throws gives the default.
 */
export function readSecondLang<L extends string>(storage: Storage, others: readonly L[]): L | null {
	const read = (key: string) => {
		try {
			return storage.getItem(key);
		} catch {
			return null;
		}
	};
	const offered = (key: string) => others.find((l) => l === read(key));
	const stored = offered(LANG_KEY);
	if (stored) return stored;
	const old = offered(OLD_LANG_KEY);
	if (old) {
		try {
			storage.setItem(LANG_KEY, old);
		} catch {
			/* not remembered */
		}
		return old;
	}
	return others[0] ?? null;
}

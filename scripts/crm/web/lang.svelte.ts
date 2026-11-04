// The CRM-wide second language, shown beside English everywhere (the Facts tab's texts, translations): one value,
// reactive, picked in the app header and remembered in `localStorage` (`crm.lang`).
import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';
import { writePref } from './map/storage';
import { LANG_KEY, readSecondLang } from './second-lang';

function initial(): Lang | null {
	try {
		return readSecondLang(localStorage, OTHER_LANGS);
	} catch {
		/* no storage at all: the default */
		return OTHER_LANGS[0] ?? null;
	}
}

let lang = $state<Lang | null>(initial());

/** The language beside English; null on a site with English only. */
export function secondLang(): Lang | null {
	return lang;
}

/** Picks the second language everywhere and remembers it; one the site doesn't translate into is ignored. */
export function setSecondLang(next: Lang): void {
	if (!(OTHER_LANGS as readonly string[]).includes(next)) return;
	lang = next;
	writePref(LANG_KEY, next);
}

/**
 * The site's languages, the one list everything else reads: the facts
 * validator, the post and place loaders, the CRM and the Node scripts.
 * English is the source; every other language is an optional translation.
 * Adding one is: add it to `LANGS` in `translation-name.js` (plain JS, so the
 * Node scripts share it), add its JSON table and its import line in `strings.ts`.
 *
 * Framework-free and browser-safe.
 */

import { LANGS, OTHER_LANGS as OTHERS } from './translation-name.js';

export { LANGS };
export type Lang = (typeof LANGS)[number];

/** Every language but English: the ones a text may translate into. */
export const OTHER_LANGS = OTHERS as readonly Exclude<Lang, 'en'>[];

export function isLang(s: string): s is Lang {
	return (LANGS as readonly string[]).includes(s);
}

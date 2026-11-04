/**
 * The one file-name rule for translations: `<source>.<lang>.md` beside the
 * English file it translates.
 *
 *  - posts: `2026-07-19-schneefernerkopf.de.md` in `hikes/markdown/`;
 *  - place docs: `knorrhuette.de.md` in `hikes/places/`.
 *
 * Every reader of those folders asks this first, so a translation is never
 * listed as a post or place doc of its own. The rule itself is plain JS in
 * `translation-name.js`, shared with the Node scripts; this is its typed face.
 *
 * Framework-free and browser-safe.
 */

import type { Lang } from './languages';
import { translationName } from './translation-name.js';

/**
 * The source file and language a translation file is named for, or null for
 * any other file. Throws on a translation-shaped name in a language the site
 * doesn't translate into (`.fr.md`, `.DE.md`, `.en.md`), so a typo fails the
 * build instead of turning into a post.
 */
export function translationOf(file: string): { source: string; lang: Lang } | null {
	return translationName(file) as { source: string; lang: Lang } | null;
}

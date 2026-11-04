/**
 * The site's languages and the translation file-name rule, in plain JS so the
 * Node scripts (`scripts/load-hikes.js`, through `hikes-core.js`) share them
 * with the site. `languages.ts` and `translation-file.ts` give them their
 * types; read them from there in TypeScript.
 *
 * English is the source; every other language is an optional translation.
 * Adding one is: add it to `LANGS`, add its JSON table and its import line in
 * `strings.ts`.
 *
 * Dependency-free and browser-safe.
 */

/** The one language list. */
export const LANGS = /** @type {const} */ (['en', 'de']);

/** Every language but English: the ones a text may translate into. */
export const OTHER_LANGS = LANGS.filter((lang) => lang !== 'en');

/**
 * A translation beside a post or place doc: `2025-03-02-seekarkreuz.de.md` ->
 * source `2025-03-02-seekarkreuz`, code `de`. Slugs never hold a dot, so the
 * code is always the last part before `.md`. Any code and any case, so a typo'd
 * `.fr.md` or `.DE.md` is caught by `translationName` instead of read as a post.
 */
export const TRANSLATION_FILE = /^(.+)\.([A-Za-z]{2})\.md$/;

/**
 * The source file and language a translation file is named for, or null for
 * any other file. Throws on a translation-shaped name in a language the site
 * doesn't translate into (`.fr.md`, `.DE.md`, `.en.md`).
 *
 * @param {string} file
 * @returns {{ source: string; lang: string } | null}
 */
export function translationName(file) {
	const match = TRANSLATION_FILE.exec(file);
	if (!match) return null;
	const [, base, code] = match;
	if (!(/** @type {readonly string[]} */ (OTHER_LANGS)).includes(code)) {
		throw new Error(`Unknown language "${code}" in ${file} (${OTHER_LANGS.join(', ')})`);
	}
	return { source: `${base}.md`, lang: code };
}

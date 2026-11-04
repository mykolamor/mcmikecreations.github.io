import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TRANSLATION_FILE } from '../../../src/lib/i18n/translation-name.js';
import { readFrontmatterDoc } from '../lib/frontmatter';

/**
 * Whether `file` is named like a translation (`<source>.<lang>.md`, any language, so a typo'd `.fr.md` counts):
 * such a file is never a post or place doc of its own. Unlike translationOf it never throws; `check` reports the
 * unknown languages.
 */
export const isTranslationFile = (file: string): boolean => TRANSLATION_FILE.test(file);

/** The translation files next to the post or place doc `file`, by name. */
export function translationFilesOf(file: string): string[] {
	const dir = path.dirname(file);
	const stem = path.basename(file, '.md');
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => TRANSLATION_FILE.exec(f)?.[1] === stem)
		.sort()
		.map((f) => path.join(dir, f));
}

/** The bodies of the translations next to `file`; the whole text when a translation's front matter is unreadable. */
export function translationBodies(file: string): string[] {
	return translationFilesOf(file).map((f) => {
		const raw = readFileSync(f, 'utf8');
		try {
			return readFrontmatterDoc(raw).body;
		} catch {
			return raw;
		}
	});
}

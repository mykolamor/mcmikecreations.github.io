/**
 * `paragraphs()`: a paragraph list from the string tables (`strings.ts`), each
 * paragraph's inline markdown rendered to HTML. Apart from `strings.ts` so
 * that only a page that shows paragraphs loads `marked`.
 *
 * Framework-free and browser-safe.
 */

import { Marked } from 'marked';
import { site } from './strings';
import type { Lang } from './languages';

/** `paragraphs` over the given tables' `paragraphList` (the site's are below; tests pass their own). */
export function paragraphsOf(tables: { paragraphList(lang: Lang, key: string): string[] }) {
	return (lang: Lang, key: string): string[] =>
		tables.paragraphList(lang, key).map((paragraph) => inlineMarkdown().parseInline(paragraph) as string);
}

/** The key's markdown paragraphs, each rendered to inline HTML. */
export const paragraphs = paragraphsOf(site);

let marked: Marked | undefined;
function inlineMarkdown(): Marked {
	return (marked ??= new Marked({ async: false }));
}

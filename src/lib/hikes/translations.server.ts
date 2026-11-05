/**
 * Server-only: parsing and checking translation files, the `<source>.<lang>.md`
 * beside a post or place doc (`translationOf` names them). The folders are
 * globbed in `hikes.server.ts` and `places.server.ts`; this half has no Vite
 * globs, so it runs under plain Node for tests.
 *
 * A translation carries only its texts, the rest stays the English file's:
 *
 *     ---
 *     title: Knorrhütte              # optional, each one
 *     description: DAV-Hütte unter dem Zugspitzplatt.
 *     aliases: [Knorr-Hütte]         # place docs only
 *     section: Programmierung        # blog posts only
 *     ---
 *     The whole translated body, images and all.
 *
 * Anything malformed throws, naming the file: a key the English file owns, a
 * translation whose source is gone, a photo or clip that isn't there.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { Marked, type Tokens } from 'marked';
import { translationOf } from '$lib/i18n/translation-file';
import type { Lang } from '$lib/i18n/languages';
import { AVIF_TIERS, avifVariantHref } from '$lib/renderers/responsive-image';

export type TranslationKind = 'post' | 'place' | 'blog';

/** A translation file read from disk, before rendering. */
export interface ParsedTranslation {
	lang: Lang;
	/** The English file it translates, e.g. `knorrhuette.md`. */
	source: string;
	title?: string;
	description?: string;
	/** Place docs only. */
	aliases?: string[];
	/** Blog posts only: the `article:section` / `articleSection` in this language. */
	section?: string;
	/** The body, front matter removed; empty when only the texts above are translated. */
	body: string;
}

/** Translations by source file, then language. */
export type TranslationsBySource = ReadonlyMap<string, Partial<Record<Lang, ParsedTranslation>>>;

const ALLOWED_KEYS: Record<TranslationKind, readonly string[]> = {
	post: ['title', 'description'],
	place: ['title', 'description', 'aliases'],
	blog: ['title', 'description', 'section']
};

/**
 * The site's root: the nearest folder above this module holding
 * `svelte.config.js`. Found from the module, not the working directory, so it
 * holds for the source under tests and for the bundled server chunk at build.
 */
function siteRootOf(moduleUrl: string): string {
	let dir = path.dirname(fileURLToPath(moduleUrl));
	while (!existsSync(path.join(dir, 'svelte.config.js'))) {
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error(`Translations: no svelte.config.js above ${fileURLToPath(moduleUrl)}`);
		dir = parent;
	}
	return dir;
}

export const SITE_ROOT = siteRootOf(import.meta.url);

/**
 * Every local photo and clip a markdown body shows, as the site's renderer
 * reads them: marked's image tokens, wherever they sit (paragraphs, lists,
 * quotes), with links in their alt text, either kind of title and `<…>` hrefs.
 * Remote media and the `/404/` placeholder are left out. Raw hrefs, in order.
 */
export function localMediaHrefs(body: string): string[] {
	const marked = new Marked();
	const out: string[] = [];
	marked.walkTokens(marked.lexer(body), (token) => {
		if (token.type !== 'image') return;
		const href = (token as Tokens.Image).href.trim();
		if (href.startsWith('/') && !href.startsWith('//') && !/^\/404\/?$/.test(href)) out.push(href);
	});
	return out;
}

/**
 * Whether a photo or clip (a decoded served path) is a file of `root`'s
 * `static/`. A photo also counts when only its AVIF tiers are there: those are
 * what the page serves, and most originals aren't kept.
 */
export function staticMediaExists(servedPath: string, root: string = SITE_ROOT): boolean {
	const file = (p: string) => existsSync(path.join(root, 'static', p));
	if (file(servedPath)) return true;
	return !servedPath.toLowerCase().endsWith('.mp4') && AVIF_TIERS.some((target) => file(avifVariantHref(servedPath, target)));
}

/** One translation from its file name (`knorrhuette.de.md`) and contents. */
export function parseTranslation(file: string, raw: string, kind: TranslationKind): ParsedTranslation {
	const named = translationOf(file);
	if (!named) throw new Error(`Translation ${file}: name it <source>.<lang>.md`);
	let parsed: { data: Record<string, unknown>; content: string };
	try {
		const m = matter(raw);
		parsed = { data: (m.data ?? {}) as Record<string, unknown>, content: m.content };
	} catch (ex) {
		throw new Error(`Translation ${file}: malformed front matter: ${(ex as Error).message}`);
	}
	const { data, content } = parsed;
	const allowed = ALLOWED_KEYS[kind];
	for (const key of Object.keys(data)) {
		if (!allowed.includes(key)) {
			throw new Error(`Translation ${file}: unknown front matter key "${key}" (expected ${allowed.join(', ')})`);
		}
	}
	const out: ParsedTranslation = { lang: named.lang, source: named.source, body: content.trim() ? content : '' };
	for (const key of ['title', 'description', 'section'] as const) {
		const value = data[key];
		if (value == null) continue;
		if (typeof value !== 'string') throw new Error(`Translation ${file}: ${key}: expected text`);
		if (!value.trim()) throw new Error(`Translation ${file}: ${key} is empty`);
		out[key] = value.trim();
	}
	if (data.aliases != null) {
		const aliases = data.aliases;
		if (!Array.isArray(aliases) || !aliases.every((v) => typeof v === 'string' && v.trim())) {
			throw new Error(`Translation ${file}: aliases: expected a list of names`);
		}
		out.aliases = aliases.map((v: string) => v.trim());
	}
	return out;
}

/**
 * A folder's markdown, by file name, split into its documents (the posts or
 * place docs) and its translations. Throws on a translation in an unknown
 * language, naming the file.
 */
export function splitTranslations(files: Record<string, string>): {
	docs: Record<string, string>;
	translations: Record<string, string>;
} {
	const docs: Record<string, string> = {};
	const translations: Record<string, string> = {};
	for (const [file, raw] of Object.entries(files)) {
		(translationOf(file) ? translations : docs)[file] = raw;
	}
	return { docs, translations };
}

/**
 * Every translation of a folder, parsed and checked against the folder's
 * documents (`sources`, by file name): its source must exist, and so must
 * every local photo and clip its body shows, under `root`'s `static/` (default:
 * this site's) or as `mediaExists` says.
 */
export function collectTranslations(
	kind: TranslationKind,
	translations: Record<string, string>,
	sources: ReadonlySet<string>,
	{
		root = SITE_ROOT,
		mediaExists = (servedPath: string) => staticMediaExists(servedPath, root)
	}: { root?: string; mediaExists?: (servedPath: string) => boolean } = {}
): TranslationsBySource {
	const out = new Map<string, Partial<Record<Lang, ParsedTranslation>>>();
	for (const [file, raw] of Object.entries(translations)) {
		const t = parseTranslation(file, raw, kind);
		if (!sources.has(t.source)) throw new Error(`Translation ${file}: no ${t.source} beside it to translate`);
		for (const href of localMediaHrefs(t.body)) {
			let servedPath: string;
			try {
				servedPath = decodeURI(href);
			} catch {
				throw new Error(`Translation ${file}: ${href}: malformed URL escape`);
			}
			if (!mediaExists(servedPath)) {
				throw new Error(`Translation ${file}: ${href} does not exist (not in static/, nor its AVIF tiers)`);
			}
		}
		const bySource = out.get(t.source) ?? {};
		bySource[t.lang] = t;
		out.set(t.source, bySource);
	}
	return out;
}

/**
 * The posts' and the place docs' translations in one map: a post's under its
 * file name (`2026-07-19-x.md`), a place doc's under its folder and file name
 * (`places/knorrhuette.md`), so the two can never clash.
 */
export function mergeTranslations({
	posts,
	places
}: {
	posts: TranslationsBySource;
	places: TranslationsBySource;
}): TranslationsBySource {
	return new Map([...posts, ...[...places].map(([source, byLang]) => [`places/${source}`, byLang] as const)]);
}

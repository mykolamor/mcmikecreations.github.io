/**
 * The site's strings, per language: one JSON table each in
 * `src/lib/hikes/i18n/`, keyed by a dotted path (`facts.labels.climbing`,
 * `list.tagTitle`). `en.json` holds every key; another language holds any
 * subset, and a key it lacks reads as the English.
 *
 * A string may hold, and nothing else:
 * - a placeholder, `{name}`;
 * - a select form, `{page, select, 1 {} other { - Page {page}}}`;
 * - a plural form, `{count, plural, one {# hike} other {# hikes}}`, where `#`
 *   is the number;
 * - a literal brace, escaped as `'{'` or `'}'`.
 *
 * A paragraph list (a JSON array) is read with `paragraphs()`, from
 * `paragraphs.ts`, which renders its inline markdown; it is kept apart so
 * that a page reading only `t()` doesn't load `marked`.
 *
 * Framework-free and browser-safe.
 */

// One import per language's table, the tables' only importer (a test checks
// both); a language added to `LANGS` needs its line here.
import en from '../hikes/i18n/en.json';
import de from '../hikes/i18n/de.json';
import uk from '../hikes/i18n/uk.json';
import { LANGS, type Lang } from './languages';

export type Table = { [key: string]: string | string[] | Table };
export type Params = Record<string, string | number>;

/** `langs`' tables from `imported`, in `langs`' order; throws for a language without one or a table of none. */
export function tablesFor<T extends { en: Table }>(langs: readonly string[], imported: T & Record<string, Table>): { en: T['en'] } & Record<string, Table> {
	for (const lang of Object.keys(imported)) {
		if (!langs.includes(lang)) throw new Error(`A string table for "${lang}", which is not in LANGS`);
	}
	return Object.fromEntries(langs.map((lang) => {
		if (!imported[lang]) throw new Error(`No string table for "${lang}": add src/lib/hikes/i18n/${lang}.json and its import in strings.ts`);
		return [lang, imported[lang]];
	})) as { en: T['en'] } & Record<string, Table>;
}

/** The site's tables, one per language in `LANGS`. Read them through `t()`; the facts labels' view (`facts-strings.ts`) reads them here. */
export const TABLES = tablesFor(LANGS, { en, de, uk }) as { en: typeof en } & Record<Lang, Table>;

/** `t`, `tHtml`, `tSplit`, `paragraphList` and `missingKeys` over the given tables (the site's are below; tests pass their own). */
export function stringTables(tables: { en: Table } & Partial<Record<Lang, Table>>) {
	/** The key's value in `lang`, falling back to English; throws when English lacks it. */
	function entry(lang: Lang, key: string): string | string[] {
		const value = lookup(tables[lang], key) ?? lookup(tables.en, key);
		if (value === undefined) throw new Error(`No English string "${key}"`);
		return value;
	}

	function t(lang: Lang, key: string, params: Params = {}): string {
		return render(parse(text(lang, key), key, false), { key, lang, params });
	}

	function text(lang: Lang, key: string): string {
		const value = entry(lang, key);
		if (typeof value !== 'string') throw new Error(`String "${key}" is a paragraph list; read it with paragraphs()`);
		return value;
	}

	return {
		t,

		/**
		 * `t` for an HTML string (a map popup, the renderer's markup): the
		 * string's own text is escaped, the params go in as given, so a caller
		 * escapes any text among them.
		 */
		tHtml(lang: Lang, key: string, params: Params = {}): string {
			return render(parse(text(lang, key), key, false), { key, lang, params, escape: escapeHtml });
		},

		/**
		 * The key's string cut at the placeholder `slot`: the text before and after
		 * it, for a component that puts markup there (`Hikes Tagged: <span>{tag}</span>`).
		 */
		tSplit(lang: Lang, key: string, slot: string, params: Params = {}): [string, string] {
			const parts = t(lang, key, { ...params, [slot]: SLOT }).split(SLOT);
			if (parts.length !== 2) throw new Error(`String "${key}" must hold "{${slot}}" exactly once`);
			return [parts[0], parts[1]];
		},

		/** The key's paragraphs, as their markdown source; `paragraphs()` renders them. */
		paragraphList(lang: Lang, key: string): string[] {
			const value = entry(lang, key);
			if (!Array.isArray(value)) throw new Error(`String "${key}" is not a paragraph list; read it with t()`);
			return value;
		},

		/** The keys in English that `lang`'s table lacks. */
		missingKeys(lang: Lang): string[] {
			return leafKeys(tables.en).filter((key) => lookup(tables[lang], key) === undefined);
		}
	};
}

export const site = stringTables(TABLES);

export const t = site.t;
export const tSplit = site.tSplit;
export const tHtml = site.tHtml;
/**
 * The key's paragraphs as plain text, for a page that shows them as text: a
 * `{@html}` block adds hydration markers to the prerendered HTML, and `marked`
 * would join the page's scripts. A test checks they hold no markdown.
 */
export const paragraphTexts = site.paragraphList;
export const missingKeys = site.missingKeys;

/** Every string in `table` that doesn't parse, as `key: error`, each branch of every form checked. */
export function syntaxErrors(table: Table, prefix = ''): string[] {
	return Object.entries(table).flatMap(([name, value]) => {
		const key = prefix + name;
		// A paragraph list is markdown, read verbatim.
		if (Array.isArray(value)) return [];
		if (typeof value !== 'string') return syntaxErrors(value, `${key}.`);
		try {
			parse(value, key, false);
			return [];
		} catch (error) {
			if (error instanceof StringSyntaxError) return [`${key}: ${error.detail}`];
			throw error;
		}
	});
}

/** The string or paragraph list at the dotted `key`; undefined when `table` has none there. */
export function lookup(table: Table | undefined, key: string): string | string[] | undefined {
	let node: Table[string] | undefined = table;
	for (const part of key.split('.')) {
		if (!node || typeof node === 'string' || Array.isArray(node)) return undefined;
		node = node[part];
	}
	return typeof node === 'string' || Array.isArray(node) ? node : undefined;
}

/** Every string's and paragraph list's dotted key in `table`, in its order. */
export function leafKeys(table: Table, prefix = ''): string[] {
	return Object.entries(table).flatMap(([name, value]) =>
		typeof value === 'string' || Array.isArray(value) ? [prefix + name] : leafKeys(value, `${prefix}${name}.`)
	);
}

/** `text` safe as HTML text or inside a double-quoted attribute. */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Stands for `tSplit`'s slot while the string is filled; no table string holds it. */
const SLOT = '\u0000';

/** A string's pieces: text, a `#`, a placeholder, or a select/plural form with its cases' pieces. */
type Piece =
	| string
	| { hash: true }
	| { name: string; kind?: undefined }
	| { name: string; kind: 'select' | 'plural'; cases: Map<string, Piece[]> };

const PLURAL_CASES = ['zero', 'one', 'two', 'few', 'many', 'other'];

class StringSyntaxError extends Error {
	constructor(
		key: string,
		readonly detail: string
	) {
		super(`String "${key}": ${detail}`);
	}
}

/** `message`'s pieces; `inPlural` when it is a plural case's text, where `#` is the number. */
function parse(message: string, key: string, inPlural: boolean): Piece[] {
	const pieces: Piece[] = [];
	let text = '';
	for (let i = 0; i < message.length; i++) {
		const char = message[i];
		if (char === "'" && (message[i + 1] === '{' || message[i + 1] === '}') && message[i + 2] === "'") {
			text += message[i + 1];
			i += 2;
		} else if (char === '#' && inPlural) {
			pieces.push(text, { hash: true });
			text = '';
		} else if (char === '{') {
			const end = closing(message, i, key);
			pieces.push(text, argument(message.slice(i + 1, end), key, inPlural));
			text = '';
			i = end;
		} else if (char === '}') {
			throw new StringSyntaxError(key, 'unmatched "}"');
		} else {
			text += char;
		}
	}
	pieces.push(text);
	return pieces.filter((piece) => piece !== '');
}

/** `name`, `name, select, …` or `name, plural, …`: the text inside one `{…}`. */
function argument(inside: string, key: string, inPlural: boolean): Piece {
	const match = /^\s*(\w+)\s*(?:,\s*(select|plural)\s*,([\s\S]*))?$/.exec(inside);
	if (!match) throw new StringSyntaxError(key, `bad placeholder "{${inside}}"`);
	const [, name, kind, body] = match;
	if (!kind) return { name };

	const cases = new Map<string, Piece[]>();
	for (const [caseName, text] of formCases(body, key)) {
		if (kind === 'plural' && !PLURAL_CASES.includes(caseName))
			throw new StringSyntaxError(key, `plural case "${caseName}" is not one of ${PLURAL_CASES.join(', ')}`);
		cases.set(caseName, parse(text, key, kind === 'plural' || inPlural));
	}
	if (!cases.has('other')) throw new StringSyntaxError(key, `"${name}" has no "other" case`);
	return { name, kind: kind as 'select' | 'plural', cases };
}

type Context = { key: string; lang: Lang; params: Params; count?: number; escape?: (text: string) => string };

/** Fills the pieces' placeholders and forms; `count` is the number a `#` stands for. */
function render(pieces: Piece[], context: Context): string {
	let out = '';
	for (const piece of pieces) {
		if (typeof piece === 'string') {
			out += context.escape ? context.escape(piece) : piece;
			continue;
		}
		if ('hash' in piece) {
			out += String(context.count);
			continue;
		}
		const value = context.params[piece.name];
		if (value === undefined) throw new Error(`String "${context.key}" needs the "${piece.name}" parameter`);
		if (!piece.kind) {
			out += String(value);
		} else if (piece.kind === 'select') {
			out += render(piece.cases.get(String(value)) ?? piece.cases.get('other')!, context);
		} else {
			if (typeof value !== 'number' || Number.isNaN(value))
				throw new Error(`String "${context.key}": "${piece.name}" must be a number for its plural form`);
			const pick = new Intl.PluralRules(context.lang).select(value);
			out += render(piece.cases.get(pick) ?? piece.cases.get('other')!, { ...context, count: value });
		}
	}
	return out;
}

/** `one {# hike} other {# hikes}` -> `one` → `# hike`, `other` → `# hikes`. */
function formCases(body: string, key: string): Map<string, string> {
	const cases = new Map<string, string>();
	let i = 0;
	while (i < body.length) {
		const match = /^\s*([^\s{}]+)\s*\{/.exec(body.slice(i));
		if (!match) {
			if (body.slice(i).trim() === '') break;
			throw new StringSyntaxError(key, `bad form case "${body.slice(i).trim()}"`);
		}
		const open = i + match[0].length - 1;
		const end = closing(body, open, key);
		cases.set(match[1], body.slice(open + 1, end));
		i = end + 1;
	}
	return cases;
}

/** The index of the `}` closing the `{` at `open`, skipping escaped braces. */
function closing(text: string, open: number, key: string): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "'" && (text[i + 1] === '{' || text[i + 1] === '}') && text[i + 2] === "'") i += 2;
		else if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0) return i;
	}
	throw new StringSyntaxError(key, 'unclosed "{"');
}

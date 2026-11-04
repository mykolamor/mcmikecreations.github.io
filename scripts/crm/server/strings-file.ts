// The site's label and tag tables (`src/lib/hikes/i18n/<lang>.json`) as the Strings tab reads and writes them: each
// table's strings by dotted key, and the file's version. A write sets or clears keys of one other language's table, in
// place and in the file's own layout, checked as the site parses the strings, and goes through the version protocol.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findNodeAtLocation, parseTree, type JSONPath } from 'jsonc-parser';
import { OTHER_LANGS } from '../../../src/lib/i18n/languages';
import { leafKeys, lookup, syntaxErrors, type Table } from '../../../src/lib/i18n/strings';
import { versionOf, writeAtomic } from './doc';
import { withDocLock } from './doc-lock';
import { ApiError } from './errors';
import { repoPaths } from './paths';
import { editSidecar, type JsonStyle } from './sidecar-file';

export type StringValue = string | string[];
export type StringsState = { version: string; en: Record<string, StringValue>; own: Record<string, StringValue> };

/** Thrown when `base` is not the table's current version; the route answers 409 with the current version. */
export class StaleStringsError extends ApiError {
	constructor(
		lang: string,
		public version: string
	) {
		super(409, `${lang}.json changed on disk`);
	}
}

export const stringsPath = (root: string, lang: string): string => path.join(repoPaths(root).strings, `${lang}.json`);

const readText = (root: string, lang: string): string | null => (existsSync(stringsPath(root, lang)) ? readFileSync(stringsPath(root, lang), 'utf8') : null);

/** The table's strings and paragraph lists by dotted key, in its order. */
const flat = (table: Table): Record<string, StringValue> => Object.fromEntries(leafKeys(table).map((key) => [key, lookup(table, key)!]));

function assertLang(lang: string): void {
	if (!(OTHER_LANGS as readonly string[]).includes(lang)) throw new ApiError(400, `lang must be one of: ${OTHER_LANGS.join(', ')}`);
}

/** A table's text parsed; a file edited by hand into broken JSON is a 422 with the parser's message. */
function parseTable(text: string, lang: string): Table {
	try {
		return JSON.parse(text) as Table;
	} catch (e) {
		throw new ApiError(422, `${lang}.json is not valid JSON: ${(e as Error).message}`);
	}
}

export function readStrings(root: string, lang: string): StringsState {
	assertLang(lang);
	const own = readText(root, lang);
	return { version: versionOf(own ?? ''), en: flat(parseTable(readText(root, 'en')!, 'en')), own: flat(own === null ? {} : parseTable(own, lang)) };
}

/** `value` checked against the English one (a string for a string, a list of strings for a list); null when blank. */
function normalise(key: string, value: unknown, en: StringValue | undefined): StringValue | null {
	if (en === undefined) throw new ApiError(400, `no English string "${key}"`);
	if (value === null) return null;
	if (typeof en === 'string') {
		if (typeof value !== 'string') throw new ApiError(400, `"${key}" must be a string`);
		return value.trim() === '' ? null : value;
	}
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new ApiError(400, `"${key}" must be a list of strings`);
	return value.length ? value : null;
}

/** The object at `parts` in `text`, if there is one. */
function objectAt(text: string, parts: string[]) {
	const root = parseTree(text);
	const node = root && (parts.length ? findNodeAtLocation(root, parts as JSONPath) : root);
	return node?.type === 'object' ? node : undefined;
}

/**
 * Sets each key of `set` (`null`, or a blank text, removes it) in `lang`'s table at version `base`; answers the new
 * state. Only the touched keys' bytes change: a new key goes after the nearest key before it in English order that the
 * file has (else at the end of its object), with any missing parent objects; a group left empty goes too. A string the
 * site wouldn't parse is a 400 naming its key; a stale `base` a 409.
 */
export async function writeStrings(root: string, lang: string, base: string, set: Record<string, StringValue | null>): Promise<StringsState> {
	assertLang(lang);
	if (!set || typeof set !== 'object' || Array.isArray(set)) throw new ApiError(400, 'set must be { key: value | null }');
	const enText = readText(root, 'en')!;
	const enTable = parseTable(enText, 'en');
	const enFlat = flat(enTable);
	const edits = Object.entries(set).map(([key, value]) => [key, normalise(key, value, enFlat[key])] as const);
	// A new paragraph list is laid out as English lays it out: on one line, or one paragraph per line.
	const enTree = parseTree(enText)!;
	const style: JsonStyle = {
		unit: '\t',
		multiline: (p) => {
			const node = findNodeAtLocation(enTree, p as JSONPath);
			return !!node && enText.slice(node.offset, node.offset + node.length).includes('\n');
		}
	};
	return withDocLock(`strings:${lang}`, () => {
		const original = readText(root, lang);
		if (original !== null) parseTable(original, lang);
		const version = versionOf(original ?? '');
		if (version !== base) throw new StaleStringsError(lang, version);
		let text = original ?? '{\n}\n';
		for (const [key, value] of edits) {
			const parts = key.split('.');
			if (value === null) {
				if (lookup(JSON.parse(text), key) === undefined) continue;
				text = editSidecar(text, [{ path: parts, value: undefined }], style);
				for (let n = parts.length - 1; n > 0 && !objectAt(text, parts.slice(0, n))?.children?.length; n--)
					text = editSidecar(text, [{ path: parts.slice(0, n), value: undefined }], style);
				continue;
			}
			// The deepest parent object the file has; the key (or its first missing parent) goes in there.
			let n = 0;
			while (n < parts.length - 1 && objectAt(text, parts.slice(0, n + 1))) n++;
			const nested = parts.slice(n + 1).reduceRight<unknown>((v, part) => ({ [part]: v }), value);
			const parent = objectAt(text, parts.slice(0, n));
			const has = new Set(parent?.children?.map((p) => p.children?.[0]?.value));
			const siblings = Object.keys(n ? (lookupGroup(enTable, parts.slice(0, n)) ?? {}) : enTable);
			const after = siblings.slice(0, siblings.indexOf(parts[n])).findLast((k) => has.has(k));
			text = editSidecar(text, [{ path: parts.slice(0, n + 1), value: nested, after }], style);
		}
		const touched = edits.map(([key]) => `${key}: `);
		const errors = syntaxErrors(JSON.parse(text)).filter((e) => touched.some((t) => e.startsWith(t)));
		if (errors.length) throw new ApiError(400, errors.join('; '));
		if (text !== original) writeAtomic(stringsPath(root, lang), text);
		return readStrings(root, lang);
	});
}

/** The group (nested object) of `table` at `parts`. */
function lookupGroup(table: Table, parts: string[]): Table | undefined {
	let node: Table[string] | undefined = table;
	for (const part of parts) node = node && typeof node === 'object' && !Array.isArray(node) ? node[part] : undefined;
	return node && typeof node === 'object' && !Array.isArray(node) ? node : undefined;
}

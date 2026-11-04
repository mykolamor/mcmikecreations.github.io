import { readFile, writeFile } from 'node:fs/promises';
import { Document, Scalar, YAMLMap, isMap, parseDocument, type ToStringOptions } from 'yaml';

/**
 * Comment-preserving front-matter reader/writer for hike posts and place docs.
 *
 * Built on `yaml`'s Document model; with the options below, re-stringifying an
 * unedited document reproduces every real file byte-for-byte (the golden test),
 * and an edit changes only the nodes that were touched.
 */
export const STRINGIFY_OPTIONS: ToStringOptions = {
	lineWidth: 0, // never re-wrap the long base64 `blur` lines
	minContentWidth: 0,
	flowCollectionPadding: false // `{w: 1}` not `{ w: 1 }`, as ruamel writes it
};

interface Layout {
	/** Front matter was present (otherwise the doc is empty and nothing is emitted). */
	present: boolean;
	/** The closing `---` had no trailing newline (end of file). */
	closeAtEof: boolean;
}
const layouts = new WeakMap<Document, Layout>();

/** The file starts with `---` but its front matter can't be split off (CRLF fences, no closing `---`). */
export class FrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrontmatterError';
	}
}

// The group is lazy too: an empty block (`---\n---\n`) closes at its second line, never at a `---` in the body.
const FRONT = /^---\n(?:([\s\S]*?)\n)??---(\n|$)/;

export function readFrontmatterDoc(raw: string): { doc: Document; body: string } {
	const m = FRONT.exec(raw);
	if (!m) {
		if (/^---(\r?\n|$)/.test(raw)) {
			throw new FrontmatterError('Unparseable front matter: file starts with `---` but has no LF-terminated closing `---` (CRLF line endings or unterminated block?)');
		}
		const doc = new Document({});
		layouts.set(doc, { present: false, closeAtEof: false });
		return { doc, body: raw };
	}
	const yamlText = m[1] ?? '';
	const doc = parseDocument(yamlText.length ? yamlText + '\n' : '', { keepSourceTokens: true });
	if (doc.errors.length) throw doc.errors[0];
	layouts.set(doc, { present: true, closeAtEof: m[2] === '' });
	return { doc, body: raw.slice(m[0].length) };
}

export function writeFrontmatterDoc(doc: Document, body: string): string {
	const layout = layouts.get(doc) ?? { present: true, closeAtEof: false };
	if (!layout.present && isEmptyDoc(doc)) return body;
	const text = doc.toString(STRINGIFY_OPTIONS);
	// An emptied mapping serialises as `{}`; write it as nothing (keeping any trailing comment).
	const yamlText = isEmptyDoc(doc) ? text.replace(/^(?:\{\}|null)\n\n?/, '') : text;
	return `---\n${yamlText}---${layout.closeAtEof ? '' : '\n'}${body}`;
}

function isEmptyDoc(doc: Document): boolean {
	return !doc.contents || (isMap(doc.contents) && doc.contents.items.length === 0);
}

/** Reads, applies `mutate`, writes back only if the text changed. Returns whether it did. */
export async function editFrontmatter(path: string, mutate: (doc: Document) => void): Promise<boolean> {
	const raw = await readFile(path, 'utf8');
	const { doc, body } = readFrontmatterDoc(raw);
	mutate(doc);
	const out = writeFrontmatterDoc(doc, body);
	if (out === raw) return false;
	await writeFile(path, out, 'utf8');
	return true;
}

/**
 * Builds a flow-style map (`{w: 1, taken: '…'}`) whose string values are single-quoted,
 * matching how `images` entries are written. `undefined` values are skipped.
 */
export function flowEntry(doc: Document, values: Record<string, string | number | boolean | undefined>): YAMLMap {
	const map = doc.createNode({}) as YAMLMap;
	map.flow = true;
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue;
		const scalar = new Scalar(value);
		if (typeof value === 'string') scalar.type = Scalar.QUOTE_SINGLE;
		map.set(key, scalar);
	}
	return map;
}

import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree, type JSONPath } from 'jsonc-parser';

export interface SidecarEdit {
	path: (string | number)[];
	/** `undefined` removes the key. */
	value: unknown | undefined;
	/** A new key goes after this sibling when the object has it, else at the object's end. */
	after?: string;
}

/**
 * A JSON file's layout: its indent `unit`, and how a new array of scalars is laid out (`multiline` of its path; an
 * existing one keeps its own). The sidecars' default: 2 spaces, every array of scalars on one line.
 */
export type JsonStyle = { unit: string; multiline?: (path: (string | number)[]) => boolean };

const SIDECAR_STYLE: JsonStyle = { unit: '  ' };

function isScalar(v: unknown): boolean {
	return v === null || typeof v !== 'object';
}

/** Serialises `value` (at `path`) in `style`: arrays of scalars on one line unless `style.multiline` says otherwise. */
function serialise(value: unknown, indent: string, style: JsonStyle = SIDECAR_STYLE, path: (string | number)[] = []): string {
	const inner = indent + style.unit;
	if (Array.isArray(value)) {
		if (value.every(isScalar) && !style.multiline?.(path)) return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
		if (!value.length) return '[]';
		return '[\n' + value.map((v, i) => inner + serialise(v, inner, style, [...path, i])).join(',\n') + '\n' + indent + ']';
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, v]) => v !== undefined);
		if (!entries.length) return '{}';
		return '{\n' + entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${serialise(v, inner, style, [...path, k])}`).join(',\n') + '\n' + indent + '}';
	}
	return JSON.stringify(value);
}

/** The leading whitespace of the line holding `offset`. */
export function lineIndent(text: string, offset: number): string {
	const start = text.lastIndexOf('\n', offset - 1) + 1;
	return /^[ \t]*/.exec(text.slice(start))![0];
}

/** Inserts a missing key by splicing only its own text (after the member `after`, else last); returns null when not applicable. */
function insertKey(text: string, path: (string | number)[], value: unknown, style: JsonStyle, after?: string): string | null {
	const key = path[path.length - 1];
	if (typeof key !== 'string') return null;
	const root = parseTree(text);
	if (!root) return null;
	const parent = path.length === 1 ? root : findNodeAtLocation(root, path.slice(0, -1) as JSONPath);
	if (!parent || parent.type !== 'object' || !parent.children) return null;
	if (parent.children.some((p) => p.children?.[0]?.value === key)) return null;
	const anchor = (after !== undefined && parent.children.find((p) => p.children?.[0]?.value === after)) || parent.children[parent.children.length - 1];
	if (anchor) {
		const indent = lineIndent(text, anchor.offset);
		const at = anchor.offset + anchor.length;
		return text.slice(0, at) + `,\n${indent}${JSON.stringify(key)}: ${serialise(value, indent, style, path)}` + text.slice(at);
	}
	const parentIndent = lineIndent(text, parent.offset);
	const indent = parentIndent + style.unit;
	const line = `\n${indent}${JSON.stringify(key)}: ${serialise(value, indent, style, path)}\n${parentIndent}`;
	return text.slice(0, parent.offset + 1) + line + text.slice(parent.offset + parent.length - 1);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Replaces an existing object/array value in the file's own style (jsonc-parser's `modify` would expand every nested
 * array onto separate lines). Equal values are left alone; an object with unchanged keys is edited per key, so untouched
 * members keep their text. Returns null when not applicable.
 */
function replaceValue(text: string, path: (string | number)[], value: unknown, style: JsonStyle): string | null {
	if (isScalar(value)) return null;
	const root = parseTree(text);
	const node = root && findNodeAtLocation(root, path as JSONPath);
	if (!node || node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'null') return null;
	const old = getNodeValue(node);
	if (JSON.stringify(old) === JSON.stringify(value)) return text;
	if (isObject(old) && isObject(value) && Object.keys(old).join() === Object.keys(value).join()) {
		let out = text;
		for (const k of Object.keys(value)) out = editSidecar(out, [{ path: [...path, k], value: value[k] }], style);
		return out;
	}
	const indent = lineIndent(text, node.offset);
	if (node.type === 'array' && Array.isArray(value) && value.some((v) => !isScalar(v))) {
		// Elements equal to an old one (each used once) keep their source text, so a reorder only moves lines.
		const used = new Set<number>();
		const kids = node.children ?? [];
		const inner = indent + style.unit;
		const items = value.map((v, i) => {
			const at = kids.findIndex((k, i) => !used.has(i) && JSON.stringify(getNodeValue(k)) === JSON.stringify(v));
			if (at < 0) return inner + serialise(v, inner, style, [...path, i]);
			used.add(at);
			return inner + text.slice(kids[at].offset, kids[at].offset + kids[at].length);
		});
		return text.slice(0, node.offset) + '[\n' + items.join(',\n') + '\n' + indent + ']' + text.slice(node.offset + node.length);
	}
	// With `style.multiline`, an array of scalars keeps its own layout: on one line, or one item per line.
	const own: JsonStyle = style.multiline && node.type === 'array' ? { ...style, multiline: (p) => (p.length === path.length ? text.slice(node.offset, node.offset + node.length).includes('\n') : style.multiline!(p)) } : style;
	return text.slice(0, node.offset) + serialise(value, indent, own, path) + text.slice(node.offset + node.length);
}

/**
 * Minimal-edit writer for the hand-maintained `*.hike.json` sidecars: only the touched
 * property changes; every other byte (number spellings like `1577.0`, one-line arrays) stays.
 * jsonc-parser's `modify` reformats the enclosing object when inserting, so new keys are spliced by hand.
 * The string tables use it too, in their own `style` (tab indent, see `strings-file.ts`).
 */
export function editSidecar(raw: string, edits: SidecarEdit[], style: JsonStyle = SIDECAR_STYLE): string {
	const format = style.unit.startsWith('\t') ? { insertSpaces: false, tabSize: 1 } : { insertSpaces: true, tabSize: style.unit.length };
	let out = raw;
	for (const e of edits) {
		if (e.value !== undefined) {
			const inserted = insertKey(out, e.path, e.value, style, e.after);
			if (inserted !== null) {
				out = inserted;
				continue;
			}
		}
		if (e.value !== undefined) {
			const replaced = replaceValue(out, e.path, e.value, style);
			if (replaced !== null) {
				out = replaced;
				continue;
			}
		}
		out = applyEdits(out, modify(out, e.path as JSONPath, e.value, { formattingOptions: format }));
	}
	return out;
}

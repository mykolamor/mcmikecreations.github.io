import { isCollection, type Document } from 'yaml';
import { parse } from 'jsonc-parser';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { editSidecar } from '../server/sidecar-file';
import { ApiError } from '../server/errors';
import { setYamlKeeping } from './yaml-keep';
import { specAt } from '$lib/hikes/facts-spec';
import type { FieldOp } from './ops';
import { at, isContainer, isObject, type Path } from './tree';

export type FactsOp = Extract<FieldOp, { kind: 'facts' }>;

const size = (v: unknown): number => (Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : -1);
const isDeepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A text edit (`{en, <lang>…}`, an empty string clearing that language) on the current value: undefined when nothing is
 * left, else the `{en, <lang>…}` map with every other language already there (English alone is `{en}`, never a plain string);
 * an edit that changes nothing gives `cur` back as it is.
 */
export function textValue(cur: unknown, value: unknown, where: string): unknown {
	const edit = typeof value === 'string' ? { en: value } : value;
	if (!isObject(edit) || !Object.values(edit).every((v) => typeof v === 'string')) throw new ApiError(400, `${where}: a text is {en, <lang>} strings`);
	const next: Record<string, unknown> = typeof cur === 'string' ? { en: cur } : isObject(cur) ? { ...cur } : {};
	let changed = false;
	for (const [lang, text] of Object.entries(edit as Record<string, string>)) {
		if (text.trim() === '') {
			if (lang in next) changed = true;
			delete next[lang];
		} else {
			if (next[lang] !== text) changed = true;
			next[lang] = text;
		}
	}
	// An edit that changes no language (a blank one the value doesn't have) leaves it as written, a plain string included.
	if (!changed) return cur;
	const translations = Object.keys(next).filter((k) => k !== 'en');
	if (next.en === undefined && translations.length)
		throw new ApiError(400, `${where}: the English text is required while the field has a translation (${translations.join(', ')})`);
	return Object.keys(next).length ? next : undefined;
}

/** Sets a sidecar value; an object is edited per key, so untouched members keep their text, and a missing list item can only be appended. */
function setSidecar(raw: string, path: Path, value: unknown): string {
	const root = parse(raw) as unknown;
	let i = 0;
	while (i < path.length - 1 && isContainer(at(root, path.slice(0, i + 1)))) i++;
	const parent = at(root, path.slice(0, i));
	const cur = at(root, path.slice(0, i + 1));
	let rest = value;
	for (let j = path.length - 1; j > i; j--) {
		if (typeof path[j] === 'number' && path[j] !== 0) throw new ApiError(400, `facts: no list at ${path.slice(1, j).join('.')} to put item ${path[j]} in`);
		rest = typeof path[j] === 'number' ? [rest] : { [path[j]]: rest };
	}
	if (Array.isArray(parent)) {
		const step = path[i];
		if (typeof step !== 'number' || step < 0 || step > parent.length) throw new ApiError(400, `facts: no item ${String(step)} in ${path.slice(1, i).join('.')}`);
		// Appending rewrites the list, but its other items keep their text (editSidecar's replaceValue).
		if (step === parent.length) return editSidecar(raw, [{ path: path.slice(0, i), value: [...parent, rest] }]);
	} else if (typeof path[i] === 'number') {
		throw new ApiError(400, `facts: ${path.slice(1, i).join('.') || 'facts'} is not a list`);
	}
	if (isObject(cur) && isObject(rest) && !isDeepEqual(cur, rest)) {
		let out = raw;
		for (const k of Object.keys(cur)) if (!(k in rest)) out = removeSidecar(out, [...path.slice(0, i + 1), k]);
		for (const [k, v] of Object.entries(rest)) out = setSidecar(out, [...path.slice(0, i + 1), k], v);
		return out;
	}
	return editSidecar(raw, [{ path: path.slice(0, i + 1), value: rest }]);
}

/** Removes a key or list item; a list is written without the item, so a one-line list stays on one line and other items keep their text. */
function removeSidecar(raw: string, path: Path): string {
	const root = parse(raw) as unknown;
	if (at(root, path) === undefined) return raw;
	const list = at(root, path.slice(0, -1));
	if (Array.isArray(list)) return editSidecar(raw, [{ path: path.slice(0, -1), value: list.filter((_, i) => i !== path[path.length - 1]) }]);
	return editSidecar(raw, [{ path, value: undefined }]);
}

/** The longest prefix of `path` (at least `facts`) whose container a removal emptied: removing it removes the empty containers too. */
function emptied(root: unknown, path: Path): Path | null {
	let k = path.length - 1;
	if (size(at(root, path.slice(0, k))) !== 0) return null;
	while (k > 1 && size(at(root, path.slice(0, k - 1))) === 1) k--;
	return path.slice(0, k);
}

function sidecarEdit(raw: string, path: Path, value: unknown | undefined): string {
	if (value !== undefined) return setSidecar(raw, path, value);
	let out = removeSidecar(raw, path);
	// Removing a container's last member removes the container, up to `facts`; never an emptied `[]`, `{}` or `facts`.
	const gone = emptied(parse(out), path);
	if (gone) out = removeSidecar(out, gone);
	return out;
}

const yamlRoot = (fm: Document): unknown => {
	const node = fm.getIn(['facts'], true);
	return { facts: isCollection(node) ? node.toJS(fm) : node };
};

function postEdit(raw: string, path: Path, value: unknown | undefined): string {
	const { doc: fm, body } = readFrontmatterDoc(raw);
	if (value !== undefined) {
		try {
			setYamlKeeping(fm, path, value);
		} catch (e) {
			throw new ApiError(400, `facts: ${(e as Error).message}`);
		}
	} else {
		if (!fm.hasIn(path)) return raw;
		fm.deleteIn(path);
		const gone = emptied(yamlRoot(fm), path);
		if (gone) fm.deleteIn(gone);
	}
	return writeFrontmatterDoc(fm, body);
}

/**
 * Applies one facts op to a sidecar's or a post's text, minimal-byte: only the bytes of the value set or removed change.
 * A `text` field takes `{en, <lang>}` (empty strings clear) and is written as a map, English alone as `{en}`.
 */
export function applyFactsEdit(raw: string, file: 'sidecar' | 'post', op: FactsOp): string {
	const { path } = op;
	if (!Array.isArray(path) || !path.every((s) => (typeof s === 'string' && s !== '') || (Number.isInteger(s) && (s as number) >= 0)))
		throw new ApiError(400, 'facts: the path is a list of keys and item indexes');
	const where = ['facts', ...path].join('.');
	const full = ['facts', ...path];
	let value: unknown | undefined;
	if (op.remove === true) {
		if (!path.length) throw new ApiError(400, 'facts: removing all facts at once is not an edit');
		value = undefined;
	} else if (op.value === undefined) {
		throw new ApiError(400, `${where}: a value or remove is required`);
	} else if (op.value === null) {
		if (file === 'sidecar') throw new ApiError(400, `${where}: null (removing the hike's value) is only for this visit`);
		value = null;
	} else if (specAt(path)?.t === 'text') {
		const cur = file === 'sidecar' ? at(parse(raw), full) : at(yamlRoot(readFrontmatterDoc(raw).doc), full);
		value = textValue(cur, op.value, where);
	} else {
		value = op.value;
	}
	return file === 'sidecar' ? sidecarEdit(raw, full, value) : postEdit(raw, full, value);
}

import { isCollection, isMap, isScalar, isSeq, type Document, type Node } from 'yaml';

const isDeepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const js = (doc: Document, node: unknown): unknown => (isScalar(node) || isCollection(node) ? node.toJS(doc) : node);

/** A node for a new value: maps in block style, lists of scalars in flow style (`[a, b]`), other lists in block style. */
function newNode(doc: Document, value: unknown): Node {
	const node = doc.createNode(value) as Node;
	const style = (n: unknown): void => {
		if (isMap(n)) {
			n.flow = false;
			for (const p of n.items) style(p.value);
		} else if (isSeq(n)) {
			n.flow = n.items.every((i) => !isCollection(i));
			for (const i of n.items) style(i);
		}
	};
	style(node);
	return node;
}

/**
 * The node for `value` in place of `old`, keeping as much of `old` as is equal: an equal subtree is `old` itself, a map is
 * edited per key, a list keeps the node of every item equal to an old one (each used once; else the old item at the same
 * index, edited in turn).
 */
function keep(doc: Document, old: unknown, value: unknown): unknown {
	if (old !== undefined && isDeepEqual(js(doc, old), value)) return old;
	if (isMap(old) && isObject(value)) {
		for (const pair of [...old.items]) {
			const k = isScalar(pair.key) ? pair.key.value : pair.key;
			if (!(String(k) in value)) old.delete(pair.key);
		}
		for (const [k, v] of Object.entries(value)) {
			const cur = old.get(k, true);
			if (cur === undefined && !old.has(k)) old.add(doc.createPair(k, newNode(doc, v)));
			else old.set(k, keep(doc, cur, v));
		}
		return old;
	}
	if (isSeq(old) && Array.isArray(value)) {
		const items = [...old.items];
		const used = new Set<number>();
		const matched = value.map((v) => {
			const at = items.findIndex((o, i) => !used.has(i) && isDeepEqual(js(doc, o), v));
			if (at >= 0) used.add(at);
			return at;
		});
		old.items = value.map((v, i) => {
			if (matched[i] >= 0) return items[matched[i]];
			if (i < items.length && !used.has(i) && isCollection(items[i])) {
				used.add(i);
				return keep(doc, items[i], v);
			}
			return newNode(doc, v);
		}) as typeof old.items;
		return old;
	}
	if (isScalar(old) && (value === null || typeof value !== 'object')) {
		old.value = value;
		return old;
	}
	// A value of another shape is a new node, but it keeps the old one's comments.
	const node = newNode(doc, value);
	if (isScalar(old) || isCollection(old)) {
		node.commentBefore = old.commentBefore;
		node.comment = old.comment;
	}
	return node;
}

/**
 * Sets `value` at `path` in a front-matter document and keeps the bytes and comments of every node that stays equal.
 * Missing containers on the way are created (a list only by appending at its end); a new top-level key goes before
 * `images:` when present, as `setFrontmatterValue` puts it.
 */
export function setYamlKeeping(doc: Document, path: (string | number)[], value: unknown): void {
	if (!path.length) throw new Error('setYamlKeeping needs a path');
	let parent: unknown = doc.contents;
	let i = 0;
	for (; i < path.length - 1; i++) {
		// A scalar on the way (`facts:` with no value) is replaced from its parent, as a missing node is.
		const next = isMap(parent) || isSeq(parent) ? parent.get(path[i], true) : undefined;
		if (!isCollection(next)) break;
		parent = next;
	}
	// The rest of the path below the deepest node that exists, as one new value.
	let rest = value;
	for (let j = path.length - 1; j > i; j--) {
		if (typeof path[j] === 'number' && path[j] !== 0) throw new Error(`No list at ${path.slice(0, j).join('.')} to put item ${path[j]} in`);
		rest = typeof path[j] === 'number' ? [rest] : { [path[j]]: rest };
	}
	const step = path[i];
	if (isSeq(parent)) {
		if (typeof step !== 'number' || step < 0 || step > parent.items.length) throw new Error(`No item ${String(step)} in ${path.slice(0, i).join('.')}`);
		if (step === parent.items.length) parent.items.push(newNode(doc, rest) as never);
		else parent.items[step] = keep(doc, parent.items[step], rest) as never;
		return;
	}
	if (!isMap(parent)) {
		if (doc.contents === null && i === 0) {
			doc.contents = newNode(doc, { [step]: rest }) as never;
			return;
		}
		throw new Error(`${path.slice(0, i).join('.')} is not a map or list`);
	}
	if (typeof step !== 'string') throw new Error(`${path.slice(0, i).join('.') || 'the front matter'} is a map, not a list`);
	if (parent.has(step)) {
		parent.set(step, keep(doc, parent.get(step, true), rest));
		return;
	}
	const pair = doc.createPair(step, newNode(doc, rest));
	const at = parent === doc.contents ? parent.items.findIndex((p) => isScalar(p.key) && p.key.value === 'images') : -1;
	if (at >= 0) parent.items.splice(at, 0, pair as never);
	else parent.items.push(pair as never);
}

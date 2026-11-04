// Plain values as a tree of maps and lists, read and changed by path (a number steps into a list): the Facts tab's
// local copies (web/facts/facts-state.ts, shared.ts) and the server's facts writer (facts-edit.ts). Browser-safe.

export type Path = (string | number)[];
type Container = Record<string | number, unknown>;

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A map or a list. */
export const isContainer = (v: unknown): v is Container => !!v && typeof v === 'object';
export const isEmpty = (v: unknown): boolean => isContainer(v) && Object.keys(v).length === 0;

/** The value at `path`; undefined when a step finds nothing to step into. */
export function at(root: unknown, path: Path): unknown {
	let cur = root;
	for (const step of path) cur = isContainer(cur) ? cur[step] : undefined;
	return cur;
}

/** Sets a copy of `value` at `path`, making the containers on the way (a list before a number step). */
export function setAt(root: Container, path: Path, value: unknown): void {
	let cur = root;
	path.slice(0, -1).forEach((step, i) => {
		if (!isContainer(cur[step])) cur[step] = typeof path[i + 1] === 'number' ? [] : {};
		cur = cur[step] as Container;
	});
	cur[path[path.length - 1]] = structuredClone(value);
}

/**
 * Removes the value at `path` (a list's entry is spliced out), and each container the removal leaves empty, up to the
 * first `keep` steps of the path, which stay: never a `[]` or `{}` left behind.
 */
export function removeAt(root: Container, path: Path, keep = 0): void {
	const drop = (parent: unknown, step: string | number) => {
		if (Array.isArray(parent) && typeof step === 'number') parent.splice(step, 1);
		else if (isContainer(parent)) delete parent[step];
	};
	drop(at(root, path.slice(0, -1)), path[path.length - 1]);
	for (let i = path.length - 1; i > keep && isEmpty(at(root, path.slice(0, i))); i--) drop(at(root, path.slice(0, i - 1)), path[i - 1]);
}

/**
 * Which add-on files (three.js `examples/jsm`) to vendor: only the ones
 * presentation content imports, plus whatever those import in turn. Copying
 * the whole folder is 16 MB, mostly WASM decoders no slide uses.
 * Plain JS and filesystem-free (the caller passes a reader) so it is testable.
 */

/**
 * Module specifiers a source file imports: `import … from '…'`, bare
 * `import '…'`, `export … from '…'` and `import('…')` with a literal.
 * A match inside a comment counts too, which at worst vendors one extra file.
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiers(source) {
	const out = [];
	const re = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;
	for (const m of source.matchAll(re)) out.push(m[2]);
	return out;
}

/**
 * Joins a relative specifier onto a folder and normalises `.`/`..`.
 * @param {string} dir  Add-on-relative folder, '' for the root.
 * @param {string} spec Relative specifier, e.g. `../utils/x.js`.
 * @returns {string | null} Add-on-relative path, or null when it leaves the add-ons folder.
 */
export function joinRelative(dir, spec) {
	const parts = dir ? dir.split('/') : [];
	for (const seg of spec.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			if (!parts.length) return null;
			parts.pop();
		} else parts.push(seg);
	}
	return parts.join('/');
}

/**
 * The add-on files to vendor.
 * @param {string[]} contentSources Source text of every presentation content file.
 * @param {string} prefix  Specifier prefix that names an add-on, e.g. `three/addons/`.
 * @param {(file: string) => string | null} read Add-on source by add-on-relative path; null if missing.
 * @returns {{ files: Set<string>, missing: string[] }} Every file to copy, and imports that don't exist.
 */
export function addonClosure(contentSources, prefix, read) {
	const files = new Set();
	const missing = [];
	/** @type {string[]} */
	const queue = [];
	const want = (/** @type {string | null} */ file) => {
		if (file && !files.has(file)) {
			files.add(file);
			queue.push(file);
		}
	};
	for (const source of contentSources) {
		for (const spec of importSpecifiers(source)) {
			if (spec.startsWith(prefix)) want(joinRelative('', spec.slice(prefix.length)));
		}
	}
	while (queue.length) {
		const file = /** @type {string} */ (queue.shift());
		const source = read(file);
		if (source === null) {
			files.delete(file);
			missing.push(file);
			continue;
		}
		const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
		for (const spec of importSpecifiers(source)) {
			if (spec.startsWith('./') || spec.startsWith('../')) want(joinRelative(dir, spec));
			else if (spec.startsWith(prefix)) want(joinRelative('', spec.slice(prefix.length)));
		}
	}
	return { files, missing };
}

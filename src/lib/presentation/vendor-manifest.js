/**
 * The libraries presentations may import by bare specifier, and the import map
 * that resolves them. Plain JS so `scripts/presentation-vendor.mjs` (Node) and
 * `hooks.server.ts` share it. Dependency-free.
 */

/**
 * @typedef {object} VendorEntry
 * @property {string} pkg        npm package name.
 * @property {string} specifier  Bare specifier content files import.
 * @property {string} file       Main file name inside the vendor folder.
 * @property {string} [bundle]   Entry bundled with Vite (for packages with no single ESM file).
 * @property {string | string[]} [copy]  Package-relative files copied flat into the vendor folder.
 * @property {string} [addons]   Package-relative folder copied to `addons/` and mapped as `<specifier>/addons/`.
 */

/** @type {VendorEntry[]} */
export const VENDOR = [
	{ pkg: 'd3', specifier: 'd3', file: 'd3.esm.js', bundle: 'scripts/presentation-d3-entry.js' },
	{ pkg: 'animejs', specifier: 'animejs', file: 'anime.esm.min.js', copy: 'dist/bundles/anime.esm.min.js' },
	{
		pkg: 'three',
		specifier: 'three',
		file: 'three.module.min.js',
		copy: ['build/three.module.min.js', 'build/three.core.min.js'],
		addons: 'examples/jsm'
	}
];

/**
 * @param {string} pkg
 * @param {string} version
 * @returns {string} Site-absolute folder, e.g. `/vendor/d3@7.9.0/`.
 */
export function vendorDir(pkg, version) {
	return `/vendor/${pkg}@${version}/`;
}

/**
 * @param {Record<string, string>} versions Installed version per package.
 * @returns {{ imports: Record<string, string> }}
 */
export function importMap(versions) {
	/** @type {Record<string, string>} */
	const imports = {};
	for (const entry of VENDOR) {
		const dir = vendorDir(entry.pkg, versions[entry.pkg]);
		imports[entry.specifier] = dir + entry.file;
		if (entry.addons) imports[entry.specifier + '/addons/'] = dir + 'addons/';
	}
	return { imports };
}

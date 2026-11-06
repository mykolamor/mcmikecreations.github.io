// Vendors the libraries presentations import by bare specifier into
// static/vendor/<pkg>@<version>/ and writes static/vendor/importmap.json.
// Idempotent: an existing version folder is kept, so re-runs are fast
// (vite.config.ts runs it from a plugin's buildStart). Its add-ons folder only
// holds the add-ons presentation content under static/images imports, and
// folders of other versions are removed. Also runnable directly:
// node scripts/presentation-vendor.mjs
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR, importMap } from '../src/lib/presentation/vendor-manifest.js';
import { addonClosure } from '../src/lib/presentation/vendor-addons.js';

/** Where presentation content lives; every .js/.mjs below it is scanned for add-on imports. */
const CONTENT_DIR = path.join('static', 'images');

/**
 * @param {string} [root] Project root.
 */
export async function vendorPresentationLibs(root = process.cwd()) {
	const vendorRoot = path.join(root, 'static', 'vendor');
	/** @type {Record<string, string>} */
	const versions = {};
	for (const entry of VENDOR) {
		const pkgDir = path.join(root, 'node_modules', entry.pkg);
		const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
		versions[entry.pkg] = version;
		const outDir = path.join(vendorRoot, `${entry.pkg}@${version}`);
		pruneOtherVersions(vendorRoot, entry.pkg, version);
		if (!existsSync(outDir)) await buildVersion(root, entry, pkgDir, outDir);
		if (entry.addons) syncAddons(root, path.join(pkgDir, entry.addons), path.join(outDir, 'addons'), entry.specifier + '/addons/');
	}

	mkdirSync(vendorRoot, { recursive: true });
	const mapFile = path.join(vendorRoot, 'importmap.json');
	const json = JSON.stringify(importMap(versions), null, '\t') + '\n';
	// Left alone when unchanged, so the dev server doesn't see a file change and reload.
	if (!existsSync(mapFile) || readFileSync(mapFile, 'utf8') !== json) writeFileSync(mapFile, json);
}

/**
 * Dev server fallback: content edited while `vite dev` runs may import an
 * add-on the start-up sync didn't copy. Copies that one file on request
 * (the browser then requests its imports the same way); the next start-up
 * sync settles the folder.
 * @param {string} root
 * @param {string} urlPath Decoded request path, e.g. `/vendor/three@0.184.0/addons/controls/OrbitControls.js`.
 */
export function copyAddonOnRequest(root, urlPath) {
	for (const entry of VENDOR) {
		if (!entry.addons) continue;
		const pkgDir = path.join(root, 'node_modules', entry.pkg);
		const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
		const prefix = `/vendor/${entry.pkg}@${version}/addons/`;
		if (!urlPath.startsWith(prefix)) continue;
		const addonsSrc = path.join(pkgDir, entry.addons);
		const src = path.resolve(addonsSrc, urlPath.slice(prefix.length));
		const out = path.join(root, 'static', urlPath);
		if (!src.startsWith(addonsSrc + path.sep) || !existsSync(src) || existsSync(out)) return;
		mkdirSync(path.dirname(out), { recursive: true });
		copyFileSync(src, out);
		return;
	}
}

/**
 * Bundles or copies a package's main files into `outDir`.
 * @param {string} root
 * @param {import('../src/lib/presentation/vendor-manifest.js').VendorEntry} entry
 * @param {string} pkgDir
 * @param {string} outDir
 */
async function buildVersion(root, entry, pkgDir, outDir) {
	// Build into a fresh folder name only once finished, so an interrupted run
	// never leaves a half-filled folder that a later run would skip.
	const tmpDir = outDir + '.tmp';
	mkdirSync(tmpDir, { recursive: true });
	if (entry.bundle) {
		const { build } = await import('vite');
		await build({
			root,
			configFile: false,
			logLevel: 'warn',
			build: {
				lib: {
					entry: path.join(root, entry.bundle),
					formats: ['es'],
					fileName: () => entry.file
				},
				minify: true,
				outDir: tmpDir,
				emptyOutDir: false
			}
		});
	}
	for (const file of [entry.copy ?? []].flat()) {
		cpSync(path.join(pkgDir, file), path.join(tmpDir, path.basename(file)));
	}
	renameSync(tmpDir, outDir);
	console.log(`vendored ${path.basename(outDir)}`);
}

/**
 * Removes `<pkg>@<other version>` folders and leftover `.tmp` folders, so an
 * upgrade doesn't leave the old copy around to be deployed.
 * @param {string} vendorRoot
 * @param {string} pkg
 * @param {string} version
 */
function pruneOtherVersions(vendorRoot, pkg, version) {
	if (!existsSync(vendorRoot)) return;
	for (const name of readdirSync(vendorRoot)) {
		if (name.startsWith(pkg + '@') && name !== `${pkg}@${version}`) {
			rmSync(path.join(vendorRoot, name), { recursive: true, force: true });
			console.log(`removed vendor/${name}`);
		}
	}
}

/**
 * Makes `addonsOut` hold exactly the add-ons presentation content imports
 * (and what those import): missing files are copied, unused ones deleted.
 * Files already in place are not rewritten, so the dev server sees no change.
 * @param {string} root      Project root.
 * @param {string} addonsSrc The package's add-ons folder.
 * @param {string} addonsOut The vendored add-ons folder.
 * @param {string} prefix    Specifier prefix, e.g. `three/addons/`.
 */
function syncAddons(root, addonsSrc, addonsOut, prefix) {
	const content = listFiles(path.join(root, CONTENT_DIR))
		.filter((f) => /\.m?js$/i.test(f))
		.map((f) => readFileSync(path.join(root, CONTENT_DIR, f), 'utf8'));
	const { files, missing } = addonClosure(content, prefix, (rel) => {
		const file = path.join(addonsSrc, rel);
		return existsSync(file) ? readFileSync(file, 'utf8') : null;
	});
	for (const rel of missing) console.warn(`presentation-vendor: ${prefix}${rel} is imported but doesn't exist`);
	for (const rel of files) {
		const out = path.join(addonsOut, rel);
		if (existsSync(out)) continue;
		mkdirSync(path.dirname(out), { recursive: true });
		copyFileSync(path.join(addonsSrc, rel), out);
	}
	for (const rel of listFiles(addonsOut)) {
		if (!files.has(rel)) rmSync(path.join(addonsOut, rel));
	}
	removeEmptyDirs(addonsOut);
}

/**
 * @param {string} dir
 * @returns {string[]} Every file below `dir`, as `/`-separated relative paths; [] if it doesn't exist.
 */
function listFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile())
		.map((d) => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
}

/** @param {string} dir */
function removeEmptyDirs(dir) {
	if (!existsSync(dir)) return;
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		if (d.isDirectory()) removeEmptyDirs(path.join(dir, d.name));
	}
	if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await vendorPresentationLibs(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import {
	assembleHikes,
	metaFolder,
	resolveHikeForDate as resolveDateWith,
	resolveHikeForPost as resolvePostWith
} from '../src/lib/data/hikes-core.js';
import { resolveSidecar } from '../src/lib/data/osm-store.js';
import { translationName } from '../src/lib/i18n/translation-name.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hikesPath = path.join(__dirname, '../src/lib/data/hikes.json');
const staticDir = path.join(__dirname, '../static');
const hikesDir = path.join(staticDir, '/_projects/data-viz/hikes');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

const osmPath = path.join(hikesDir, 'osm.json');
/** The shared OSM store, as `hikes-db` globs it: element by typed id. */
export const osmStore = fs.existsSync(osmPath) ? readJson(osmPath) : {};

/** Same contract as `readHikeFrontmatter`: malformed YAML logs and yields {}. */
function readFrontmatter(raw) {
	try {
		return matter(raw).data ?? {};
	} catch (ex) {
		console.log('Failed to parse hike front matter:', ex);
		return {};
	}
}

/**
 * The disk-backed lookups `hikes-db` answers from its globs, for one static dir;
 * each accepts only what its glob would have matched.
 */
function makeLookups(dir, store) {
	const hikes = path.join(dir, '/_projects/data-viz/hikes');
	/** Sidecars with their `nodes` resolved, by served path. */
	const resolvedMeta = {};
	return {
		/** The sidecar at a served path, or undefined — `hikes-db`'s `getHikeMeta`. */
		getHikeMeta(metaPath) {
			const file = path.join(dir, metaPath);
			const globbed = path.dirname(file) === path.join(dir, metaFolder) && file.endsWith('.hike.json');
			if (!globbed || !fs.existsSync(file)) return undefined;
			return (resolvedMeta[metaPath] ??= resolveSidecar(readJson(file), store, metaPath));
		},
		/** Whether a GPX file exists at a served path — `hikes-db`'s `hasGpxFile`. */
		hasGpxFile(servedPath) {
			const file = path.join(dir, servedPath);
			return file.startsWith(hikes + path.sep) && file.endsWith('.gpx') && fs.existsSync(file);
		}
	};
}

const defaultLookups = makeLookups(staticDir, osmStore);
const { getHikeMeta } = defaultLookups;
const frontmatterByPath = {};

/**
 * Node-side counterpart of `src/lib/hikes/hikes.server.ts`: the same
 * `hikes-core` assembly, fed from a static dir and a hikes.json instead of
 * `import.meta.glob`. Only the default dir feeds `resolveHikeFor*`; `fresh` re-reads
 * everything (no process-lifetime caches) for long-running callers.
 */
export function loadHikesFrom(dir, hikesJsonPath, { fresh = false } = {}) {
	const isDefault = dir === staticDir && !fresh;
	let lookups = defaultLookups;
	if (!isDefault) {
		const p = path.join(dir, '/_projects/data-viz/hikes/osm.json');
		lookups = makeLookups(dir, fs.existsSync(p) ? readJson(p) : {});
	}
	const mdDir = path.join(dir, metaFolder);
	const files = fs.readdirSync(mdDir);

	const slugs = files
		.filter((f) => f.endsWith('.hike.json'))
		.map((f) => f.replace(/\.hike\.json$/, ''))
		.sort();

	// Translations (`<date>-<slug>.<lang>.md`) are not posts; one in an unknown language throws.
	const posts = files
		.filter((f) => f.endsWith('.md') && !translationName(f))
		.map((file) => {
			const servedPath = `${metaFolder}/${file}`;
			const frontmatter = readFrontmatter(fs.readFileSync(path.join(mdDir, file), 'utf-8'));
			if (isDefault) frontmatterByPath[servedPath] = frontmatter;
			return { file, path: servedPath, frontmatter };
		});

	return assembleHikes({
		slugs,
		posts,
		overrides: readJson(hikesJsonPath),
		getHikeMeta: lookups.getHikeMeta,
		hasGpxFile: lookups.hasGpxFile
	});
}

export function loadHikes() {
	return loadHikesFrom(staticDir, hikesPath);
}

/**
 * The hike as one of its dates sees it — the date's `metaPath` sidecar swapped
 * in and its `filePath` / metric overrides promoted. Hike-level front matter is
 * not applied; see `resolveHikeForPost`.
 */
export function resolveHikeForDate(hike, date) {
	return resolveDateWith(hike, date, getHikeMeta);
}

/**
 * The hike as one post sees it, front matter included — what the post page
 * renders, map origin and height among it. Call after `loadHikes`.
 */
export function resolveHikeForPost(hike, date) {
	return resolvePostWith(hike, date, date.path ? frontmatterByPath[date.path] : undefined, getHikeMeta);
}

/**
 * `resolveHikeForPost` for a static dir that is not the default one (or must be read fresh): the post's front matter
 * and the sidecars are read from `dir` on every call. Returns the resolved hike.
 */
export function postResolverFor(dir) {
	const p = path.join(dir, '/_projects/data-viz/hikes/osm.json');
	const lookups = makeLookups(dir, fs.existsSync(p) ? readJson(p) : {});
	return (hike, date) => {
		const file = date.path ? path.join(dir, date.path) : null;
		const frontmatter = file && fs.existsSync(file) ? readFrontmatter(fs.readFileSync(file, 'utf-8')) : undefined;
		return resolvePostWith(hike, date, frontmatter, lookups.getHikeMeta).hike;
	};
}

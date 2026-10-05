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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hikesPath = path.join(__dirname, '../src/lib/data/hikes.json');
const staticDir = path.join(__dirname, '../static');
const hikesDir = path.join(staticDir, '/_projects/data-viz/hikes');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

/** Same contract as `readHikeFrontmatter`: malformed YAML logs and yields {}. */
function readFrontmatter(raw) {
	try {
		return matter(raw).data ?? {};
	} catch (ex) {
		console.log('Failed to parse hike front matter:', ex);
		return {};
	}
}

// The disk-backed lookups `hikes-db` answers from its globs; each accepts only
// what its glob would have matched.

/** The sidecar at a served path, or undefined — `hikes-db`'s `getHikeMeta`. */
function getHikeMeta(metaPath) {
	const file = path.join(staticDir, metaPath);
	const globbed = path.dirname(file) === path.join(staticDir, metaFolder) && file.endsWith('.hike.json');
	return globbed && fs.existsSync(file) ? readJson(file) : undefined;
}

/** Whether a GPX file exists at a served path — `hikes-db`'s `hasGpxFile`. */
function hasGpxFile(servedPath) {
	const file = path.join(staticDir, servedPath);
	return file.startsWith(hikesDir + path.sep) && file.endsWith('.gpx') && fs.existsSync(file);
}

const frontmatterByPath = {};

/**
 * Node-side counterpart of `src/lib/hikes/hikes.server.ts`: the same
 * `hikes-core` assembly, fed from the disk instead of `import.meta.glob`.
 */
export function loadHikes() {
	const mdDir = path.join(staticDir, metaFolder);
	const files = fs.readdirSync(mdDir);

	const slugs = files
		.filter((f) => f.endsWith('.hike.json'))
		.map((f) => f.replace(/\.hike\.json$/, ''))
		.sort();

	const posts = files
		.filter((f) => f.endsWith('.md'))
		.map((file) => {
			const servedPath = `${metaFolder}/${file}`;
			const frontmatter = readFrontmatter(fs.readFileSync(path.join(mdDir, file), 'utf-8'));
			frontmatterByPath[servedPath] = frontmatter;
			return { file, path: servedPath, frontmatter };
		});

	return assembleHikes({ slugs, posts, overrides: readJson(hikesPath), getHikeMeta, hasGpxFile });
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

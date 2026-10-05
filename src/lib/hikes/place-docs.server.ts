/**
 * Server-only: parsing and checking place docs, and the `places:` list in a
 * post's front matter. The files themselves are globbed in `places.server.ts`;
 * this half has no Vite globs, so it runs under plain Node for tests.
 *
 * A place doc is shaped like a hike post without the hike:
 *
 *     ---
 *     title: Knorrhütte
 *     description: DAV hut below the Zugspitzplatt.
 *     tags: [Hut]                      # optional
 *     aliases: [Knorrhütte, Knorr hut] # optional: more names it goes by in posts
 *     images: {...}                    # optional, written by scripts/image_optimize.py
 *     ---
 *     Markdown body, images and all.
 *
 * Anything malformed throws, naming the file: a typo'd slug in a post, or a
 * doc missing its title, fails the build instead of quietly dropping a
 * section. Browser-safe types and the prose linking live in `place-docs.ts`.
 */

import matter from 'gray-matter';
import { isPlainObject } from './frontmatter';
import type { PlaceDocRef } from './place-docs';
import schemaKeys from './schema-keys.json';

/** A place doc read from disk, before rendering. */
export interface PlaceDoc extends PlaceDocRef {
	description: string;
	tags: string[];
	/** The whole file, front matter included: the renderer reads `images` from it like a post's. */
	raw: string;
}

// Shared with scripts/matches/placedoc.py.
const { placeDoc } = schemaKeys;
/** `knorrhuette`, `zugspitz_platt`: what a file may be named and a post may list. */
const SLUG = new RegExp(placeDoc.slug);
const KNOWN_KEYS = new Set(placeDoc.knownKeys);

function readStrings(value: unknown, file: string, key: string): string[] {
	if (value == null) return [];
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.trim())) {
		throw new Error(`Place doc ${file}: ${key}: expected a list of names`);
	}
	return value.map((v: string) => v.trim());
}

/** One place doc from its file name (`knorrhuette.md`) and contents. */
export function parsePlaceDoc(file: string, raw: string): PlaceDoc {
	const slug = file.replace(/\.md$/, '');
	if (!SLUG.test(slug)) {
		throw new Error(`Place doc ${file}: name it <slug>.md, lowercase letters and digits joined by - or _`);
	}
	let data: Record<string, unknown>;
	try {
		data = (matter(raw).data ?? {}) as Record<string, unknown>;
	} catch (ex) {
		throw new Error(`Place doc ${file}: malformed front matter: ${(ex as Error).message}`);
	}
	for (const key of Object.keys(data)) {
		if (!KNOWN_KEYS.has(key)) {
			throw new Error(`Place doc ${file}: unknown front matter key "${key}" (expected ${[...KNOWN_KEYS].join(', ')})`);
		}
	}
	const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string).trim() : '');
	for (const key of placeDoc.requiredKeys) if (!text(key)) throw new Error(`Place doc ${file}: needs a ${key}`);
	const title = text('title');
	const description = text('description');
	if (data.images != null && !isPlainObject(data.images)) {
		throw new Error(`Place doc ${file}: images: expected a map of file name to image data`);
	}
	const aliases = readStrings(data.aliases, file, 'aliases');
	return {
		slug,
		title,
		description,
		tags: readStrings(data.tags, file, 'tags'),
		// The title always counts as a name; aliases add to it.
		names: [...new Set([title, ...aliases])],
		raw
	};
}

/**
 * The docs a post lists under `places:`, in its order, out of `docs`. A post
 * without its own `places:` (or with `places: null`) gets its sidecar's list;
 * a post's list replaces the sidecar's, like other hike fields. Throws on
 * anything but a list of known slugs, naming the file it came from.
 */
export function readPostPlaces(
	frontmatter: Record<string, unknown> | null | undefined,
	postSource: string,
	docs: ReadonlyMap<string, PlaceDoc>,
	sidecar?: { places?: unknown; source: string }
): PlaceDoc[] {
	if (frontmatter?.places != null) return readPlaceList(frontmatter.places, `Hike post ${postSource}`, docs);
	if (sidecar?.places != null) return readPlaceList(sidecar.places, `Hike sidecar ${sidecar.source}`, docs);
	return [];
}

function readPlaceList(value: unknown, where: string, docs: ReadonlyMap<string, PlaceDoc>): PlaceDoc[] {
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
		throw new Error(`${where}: places: expected a list of place slugs, e.g. [knorrhuette]`);
	}
	const out: PlaceDoc[] = [];
	for (const slug of new Set(value.map((v: string) => v.trim()))) {
		const doc = docs.get(slug);
		if (!doc) {
			throw new Error(
				`${where}: places: unknown place "${slug}" (no static/_projects/data-viz/hikes/places/${slug}.md)`
			);
		}
		out.push(doc);
	}
	return out;
}

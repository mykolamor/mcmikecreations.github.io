/**
 * Browser-safe helpers for YAML front matter in hike markdown files.
 *
 * Everything here is dependency-free so it can ship in the client bundle. The
 * actual YAML parsing (via `gray-matter`) lives in `frontmatter.server.ts` and
 * must stay server-only; this module only strips the fence and normalizes
 * already-parsed data.
 */

// The fence helpers are shared with the blog; re-exported so hike imports keep working.
export { stripFrontmatter, extractFrontMatterBlock } from '$lib/frontmatter';

type Dict = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Dict {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A single social/contact link for a hike participant. */
export interface HikeContactLink {
	/** Known network name (matched against the shared icon map), or null. */
	network: string | null;
	/** Freeform label used when `network` is absent, or null. */
	label: string | null;
	/** Destination URL. */
	url: string;
}

/** A hike participant shown in the contacts card. */
export interface HikeContact {
	name: string;
	avatar: string | null;
	links: HikeContactLink[];
}

/** Trim a value if it is a non-empty string, otherwise return null. */
function cleanString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize a single front-matter link entry, or return null to drop it.
 *
 * A link needs a `url` plus either a `network` (mapped to an icon downstream)
 * or a freeform `label`. Anything else is discarded.
 */
export function readContactLink(raw: unknown): HikeContactLink | null {
	if (!isPlainObject(raw)) return null;
	const url = cleanString(raw.url);
	if (!url) return null;
	const network = cleanString(raw.network);
	const label = cleanString(raw.label);
	if (!network && !label) return null;
	return { network, label, url };
}

/**
 * Normalize a single participant entry, or return null to drop it. A `name` is
 * required; `avatar` and `links` are optional and default to null / [].
 */
function readContact(raw: unknown): HikeContact | null {
	if (!isPlainObject(raw)) return null;
	const name = cleanString(raw.name);
	if (!name) return null;
	const links = Array.isArray(raw.links)
		? raw.links.map(readContactLink).filter((l): l is HikeContactLink => l !== null)
		: [];
	return { name, avatar: cleanString(raw.avatar), links };
}

/**
 * Extract and validate the `contacts` array from a post's front matter.
 *
 * Display-only: this is independent of `hikes.json`, `applyHikeOverrides`, and
 * the hashed people/search index. Pure and dependency-free (it operates on an
 * already-parsed front-matter dict), so it is safe on the client too. Never
 * throws; missing or malformed input yields an empty array, and individual bad
 * entries are dropped silently so a typo cannot break the page.
 */
export function readHikeContacts(frontmatter: Dict | null | undefined): HikeContact[] {
	if (!isPlainObject(frontmatter) || !Array.isArray(frontmatter.contacts)) return [];
	return frontmatter.contacts
		.map(readContact)
		.filter((c): c is HikeContact => c !== null);
}

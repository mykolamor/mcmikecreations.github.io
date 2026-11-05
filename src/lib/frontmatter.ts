/**
 * Browser-safe helpers for the YAML front matter fence in markdown files,
 * shared by hikes and the blog. Dependency-free: actual YAML parsing is the
 * caller's job (server: `gray-matter`; client: a lazily-imported `js-yaml`).
 */

const FRONT_MATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Return the markdown body with a leading YAML front matter block removed.
 */
export function stripFrontmatter(raw: string): string {
	return raw.replace(FRONT_MATTER_RE, '');
}

/**
 * The raw YAML text between the front matter fences (not including the
 * `---` lines themselves), or null if `raw` has no front matter block.
 */
export function extractFrontMatterBlock(raw: string): string | null {
	const m = FRONT_MATTER_RE.exec(raw);
	return m ? m[1] : null;
}

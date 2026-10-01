/**
 * Turns prerendered redirect stubs into real Apache 301s.
 *
 * `adapter-static` cannot emit an HTTP redirect, so every `redirect()` in a load
 * function becomes an HTML page with a meta refresh, served with status 200.
 * Search Console reports those as "Redirect error" rather than following them,
 * and they pass no signal to the destination. This walks the stubs the build
 * produced and appends the equivalent `RedirectMatch 301` rules to
 * `build/.htaccess`, so the redirect happens before Apache serves anything.
 *
 * Runs against `build/`, leaving `static/.htaccess` as the hand-written source —
 * the same split `sitemap-filter.js` uses for `build/sitemap.xml`.
 */

import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';

const BUILD = 'build';
const START = '# --- BEGIN GENERATED REDIRECTS (scripts/htaccess-redirects.js) ---';
const END = '# --- END GENERATED REDIRECTS ---';

/** Stub shape: `<script>location.href="…"</script><meta http-equiv="refresh" …>`. */
const TARGET = /<meta\s+http-equiv=["']refresh["']\s+content=["']\s*0\s*;\s*url=([^"']+)["']/i;

/**
 * URLs Apache must keep serving even though nothing in the build points at them
 * any more: paths that were indexed under an older shape of the site.
 */
const LEGACY = [
	// Renamed when the sidecar switched to underscores.
	['/projects/data-viz/hikes/bad-tolz-lenggries/', '/projects/data-viz/hikes/bad_tolz_lenggries/'],
	// Never real pages, but crawled and reported as 404s.
	['/404/', '/'],
	['/contact/', '/#contact'],
	// Moved to the day the photos were actually taken.
	['/hikes/2025-10-27-auer_berg/', '/hikes/2025-10-26-auer_berg/'],
	// Post exists but is unpublished; it was renamed from 2024-01-30.
	['/blog/2023-12-30-markdown-test/', '/blog/']
];

/** Apache decodes the path before matching, so a rule can only be trusted for
 *  paths that survive that round trip unchanged. */
const ASCII_SAFE = /^[A-Za-z0-9._~/-]+$/;

function* indexFiles(dir) {
	for (const item of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${item.name}`;
		if (item.isDirectory()) yield* indexFiles(path);
		else if (item.name === 'index.html') yield path;
	}
}

const rules = [];
const skipped = [];

for (const file of indexFiles(BUILD)) {
	const html = readFileSync(file, 'utf-8');
	const target = html.match(TARGET)?.[1];
	if (!target) continue;

	const from = file.slice(BUILD.length).replace(/index\.html$/, '');
	if (!ASCII_SAFE.test(from)) {
		skipped.push(from);
		continue;
	}
	rules.push([from, target]);
}

for (const [from, to] of LEGACY) {
	rules.push([from, to]);
}

rules.sort(([a], [b]) => (a < b ? -1 : 1));

// Escape the regex metacharacters that survive ASCII_SAFE, so a literal dot in a
// path cannot match any character.
const escape = (path) => path.replace(/[.]/g, '\\$&');

const block = [
	START,
	'# Generated at deploy time from the meta-refresh stubs in build/. Do not edit.',
	...rules.map(([from, to]) => `RedirectMatch 301 ^${escape(from)}$ ${to}`),
	END,
	''
].join('\n');

const htaccess = `${BUILD}/.htaccess`;
const current = readFileSync(htaccess, 'utf-8');
const existing = new RegExp(`${START}[\\s\\S]*?${END}\\n?`);

writeFileSync(
	htaccess,
	existing.test(current)
		? current.replace(existing, block)
		: `${current.replace(/\n*$/, '\n\n')}${block}`
);

console.log(`Generated ${rules.length} redirect(s) into ${htaccess}.`);
if (skipped.length) {
	console.warn(
		`Kept meta-refresh stubs for ${skipped.length} non-ASCII path(s), which cannot be` +
			` expressed as a RedirectMatch safely:\n  ${skipped.join('\n  ')}`
	);
}

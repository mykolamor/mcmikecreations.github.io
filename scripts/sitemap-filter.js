/**
 * Post-processes the sitemap that `svelte-sitemap` generates from `build/`.
 *
 * It works off each entry's prerendered HTML, so it needs no list of its own to
 * keep in sync:
 *
 *  - Drops redirect stubs. `adapter-static` renders every `redirect()` as a
 *    meta-refresh page, which has no business being advertised as a destination.
 *  - Drops `noindex` pages. Listing a page you have asked Google not to index is
 *    a contradiction, and Search Console reports it as one.
 *  - Adds `lastmod`. A dated post uses its JSON-LD `dateModified` (the last
 *    commit that changed its body), falling back to the date in its URL. A
 *    listing page (index, tag, year, route pages, home) uses the newest
 *    `lastmod` among the dated posts it links to, since it changes when they
 *    do. Pages with neither get none, rather than a fabricated build timestamp.
 */

import { readFileSync, writeFileSync } from 'fs';

const sitemap = readFileSync('build/sitemap.xml', 'utf-8');
const domain = 'https://mykolamor.com';

/** `/hikes/2026-07-26-laubeneck/` -> `2026-07-26`. */
const DATED_POST = /^\/(?:hikes|blog)\/(\d{4}-\d{2}-\d{2})-[^/]+\/$/;

/** Links to dated posts inside a page's HTML, as site paths. */
const POST_LINK = /href="(?:https:\/\/mykolamor\.com)?(\/(?:hikes|blog)\/\d{4}-\d{2}-\d{2}-[^/"#?]+\/)"/g;
const DATE_MODIFIED = /"dateModified":"(\d{4}-\d{2}-\d{2})/;

function readHtml(path) {
	try {
		return readFileSync(`build${path}index.html`, 'utf-8');
	} catch {
		return null;
	}
}

const entries = [...sitemap.matchAll(/<url>[\s\S]*?<\/url>/g)].map(([entry]) => {
	const loc = entry.match(/<loc>(.*?)<\/loc>/)?.[1];
	const path = loc ? decodeURIComponent(loc.replace(domain, '')) : null;
	return { entry, path, html: path ? readHtml(path) : null };
});

// First pass: every dated post's own lastmod, so listings can look them up.
const postLastmod = new Map();
for (const { path, html } of entries) {
	const dated = path?.match(DATED_POST);
	if (!dated) continue;
	const modified = html?.match(DATE_MODIFIED)?.[1];
	postLastmod.set(path, modified && modified > dated[1] ? modified : dated[1]);
}

function lastmodFor(path, html) {
	if (postLastmod.has(path)) return postLastmod.get(path);
	if (!html) return null;
	let newest = null;
	for (const [, link] of html.matchAll(POST_LINK)) {
		const date = postLastmod.get(decodeURIComponent(link));
		if (date && (!newest || date > newest)) newest = date;
	}
	return newest;
}

let dropped = 0;
let stamped = 0;

const filtered = entries
	.map(({ entry, path, html }) => {
		if (!path) return entry;

		if (html) {
			if (html.includes('http-equiv="refresh"') || html.includes("http-equiv='refresh'")) {
				dropped++;
				return '';
			}
			if (/<meta\s+name="robots"[^>]*noindex/i.test(html)) {
				dropped++;
				return '';
			}
		}

		const lastmod = lastmodFor(path, html);
		if (lastmod && !entry.includes('<lastmod>')) {
			stamped++;
			return entry.replace('</loc>', `</loc>\n    <lastmod>${lastmod}</lastmod>`);
		}

		return entry;
	});

const output = sitemap.replace(/<url>[\s\S]*?<\/url>/g, () => filtered.shift());

writeFileSync('build/sitemap.xml', output);
console.log(`Sitemap filtered: dropped ${dropped}, stamped lastmod on ${stamped}.`);

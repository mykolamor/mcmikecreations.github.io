/**
 * Prerender's answer to an HTTP error (`svelte.config.js`). A 404 is often
 * expected - posts probe for optional files, like a route's GPX - so it only
 * warns. A 5xx means a page failed to render: a load threw, for example on a
 * malformed photo pin or an id missing from the OSM store. That stops the
 * build, rather than leaving the page out of the deploy with one warning.
 *
 * @param {{ status: number; path: string; referrer: string | null; referenceType: string; message: string }} details
 */
export function handlePrerenderHttpError({ status, message }) {
	if (status >= 500) throw new Error(message);
	console.warn(message);
}

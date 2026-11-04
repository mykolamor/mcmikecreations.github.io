/**
 * Resolving the shared OSM store (`static/_projects/data-viz/hikes/osm.json`).
 *
 * Sidecars and photo pins name OSM elements by typed id (`node/123`, `way/4`,
 * `relation/5`); the store holds each element once. OSM owns `tags`; the
 * author's edits live in `local`, which a re-fetch leaves alone
 * (`scripts/crm/lib/osm-store-file.ts`). These turn ids back into the node
 * objects the maps, popups and place links have always used.
 *
 * Plain JS like `hikes-core.js`, so the site and the Node scripts share it.
 * Dependency-free; the store itself comes in as an argument. Server callers
 * pass `options.formatTags` (`osm-phone.js`) so the browser never loads it.
 */

/**
 * @typedef {import('./map-info').MapNode} MapNode
 * @typedef {import('./map-info').OsmEntry} OsmEntry
 * @typedef {import('./map-info').HikeMeta} HikeMeta
 * @typedef {import('./map-info').RawHikeMeta} RawHikeMeta
 */

/**
 * @typedef {object} ResolveOptions
 * @property {(tags: Record<string, any>, lat: number, lon: number) => Record<string, any>} [formatTags]
 *   Applied to the merged tags (after `local` and null deletion).
 */

export const REF_RE = /^(node|way|relation)\/(\d+)$/;

/**
 * The element `ref` names, as a map node. The author's own tags (`local` in
 * the store, kept apart from OSM's `tags`) go over `tags`; a `null` hides the
 * OSM tag. `visited` lives in `local` and so reaches the map in `tags`.
 *
 * @param {string} ref
 * @param {Record<string, OsmEntry>} store
 * @param {string} source What referenced it, for the error.
 * @param {ResolveOptions} [options]
 * @returns {MapNode}
 */
export function resolveRef(ref, store, source, options) {
	const m = REF_RE.exec(ref);
	const entry = m ? store[ref] : undefined;
	if (!m || !entry) throw new Error(`${source}: unknown OSM element ${ref}`);
	/** @type {MapNode} */
	const node = { ref, lat: entry.lat, lon: entry.lon, tags: { ...entry.tags, ...entry.local } };
	if (entry.demEle != null) node.demEle = entry.demEle;
	for (const key of Object.keys(node.tags)) if (node.tags[key] === null) delete node.tags[key];
	if (options?.formatTags) node.tags = options.formatTags(node.tags, node.lat, node.lon);
	return node;
}

/**
 * A sidecar as the site uses it: its `nodes` ids resolved, the rest as is.
 *
 * @param {RawHikeMeta} raw
 * @param {Record<string, OsmEntry>} store
 * @param {string} source
 * @param {ResolveOptions} [options]
 * @returns {HikeMeta}
 */
export function resolveSidecar(raw, store, source, options) {
	if (raw.nodes === undefined) return /** @type {HikeMeta} */ (/** @type {unknown} */ (raw));
	return { ...raw, nodes: raw.nodes.map((ref) => resolveRef(ref, store, source, options)) };
}

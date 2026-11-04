/**
 * Photo pins against the shared OSM store, for the post page's server load.
 * See `photo-pins.ts`.
 */

import { osmStore } from '$lib/data/hikes-db';
import { formatPhoneTags } from '$lib/data/osm-phone';
import { resolvePinNodes, type PinNode } from '$lib/hikes/photo-pins';

/** The elements the given documents' photo pins point to, by ref. */
export function pinNodesFor(documents: { data: unknown; source: string }[]): Record<string, PinNode> {
	return resolvePinNodes(documents, osmStore, (message) => console.warn(message), { formatTags: formatPhoneTags });
}

/**
 * Photo pins: OSM elements marked on a hike photo, stored in the post's
 * `images:` front matter beside the photo they belong to:
 *
 *     2026-07-19-01.jpg: {w: 4248, h: 3184, …, pins: [{ref: node/26863358, x: 0.5213, y: 0.1702}]}
 *
 * `x`/`y` are fractions of the photo's width and height from its top-left
 * corner, so they hold for every AVIF tier. `ref` is a typed id into the
 * shared OSM store; the server resolves the post's refs into `pinNodes`
 * (`photo-pins.server.ts`). Drawing them is `photo-pins-view.ts`'s job.
 *
 * Browser-safe: a client-side re-parse reads the same front matter.
 */

import { isPlainObject } from '$lib/hikes/frontmatter';
import { REF_RE, resolveRef, type ResolveOptions } from '$lib/data/osm-store';
import type { OsmEntry } from '$lib/data/map-info';

export interface PhotoPin {
	/** Typed OSM id, `node/123`, `way/4` or `relation/5`. */
	ref: string;
	/** Fractions of the photo's width and height, 0 to 1 from the top-left corner. */
	x: number;
	y: number;
}

/** A pinned element as the page needs it: where it is and what its popup shows. */
export interface PinNode {
	ref: string;
	lat: number;
	lon: number;
	tags: Record<string, string | null | undefined>;
}

const isFraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Every image's pins from an `images:` front matter map, and the images marked
 * `pinsReview` (replaced since they were pinned). A malformed pin throws,
 * naming `source` and the image, so a bad hand edit fails the build.
 */
export function readImagePins(images: unknown, source: string): { pins: Record<string, PhotoPin[]>; review: string[] } {
	const pins: Record<string, PhotoPin[]> = {};
	const review: string[] = [];
	if (!isPlainObject(images)) return { pins, review };
	for (const [file, meta] of Object.entries(images)) {
		if (!isPlainObject(meta)) continue;
		const fail = (problem: string): never => {
			throw new Error(`${source}: image ${file}: ${problem}`);
		};
		if (meta.pinsReview === true) review.push(file);
		if (meta.pins == null) continue;
		if (!Array.isArray(meta.pins)) fail('pins: expected a list of {ref, x, y}');
		const list = (meta.pins as unknown[]).map((pin, i) => {
			if (!isPlainObject(pin)) return fail(`pin ${i + 1}: expected {ref, x, y}`);
			const { ref, x, y } = pin;
			if (typeof ref !== 'string' || !REF_RE.test(ref)) return fail(`pin ${i + 1}: ref must be node/…, way/… or relation/…`);
			if (!isFraction(x) || !isFraction(y)) return fail(`pin ${i + 1} (${ref}): x and y must be numbers from 0 to 1`);
			return { ref, x, y };
		});
		if (list.length > 0) pins[file] = list;
	}
	return { pins, review };
}

/** The refs of all `pins`, each once, in order. */
export function pinRefs(pins: Record<string, PhotoPin[]>): string[] {
	return [...new Set(Object.values(pins).flatMap((list) => list.map((p) => p.ref)))];
}

/**
 * Where an `object-fit: contain` image is drawn inside a `boxW`×`boxH` box,
 * so a pin layer can sit on the photo rather than on the bars around it.
 */
export function containedBox(boxW: number, boxH: number, imgW: number, imgH: number): { left: number; top: number; width: number; height: number } {
	if (!(boxW > 0 && boxH > 0 && imgW > 0 && imgH > 0)) return { left: 0, top: 0, width: 0, height: 0 };
	const scale = Math.min(boxW / imgW, boxH / imgH);
	const width = imgW * scale;
	const height = imgH * scale;
	return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/**
 * The elements every document's photo pins point to, by ref: the post and its
 * place docs share one page, so one map serves all their figures. A ref
 * missing from the store throws, naming the document; images marked
 * `pinsReview` are passed to `warn`.
 */
export function resolvePinNodes(
	documents: { data: unknown; source: string }[],
	store: Record<string, OsmEntry>,
	warn: (message: string) => void,
	options?: ResolveOptions
): Record<string, PinNode> {
	const nodes: Record<string, PinNode> = {};
	for (const { data, source } of documents) {
		const { pins, review } = readImagePins(isPlainObject(data) ? data.images : undefined, source);
		for (const file of review) warn(`${source}: image ${file}: pins need review (the photo changed shape since they were placed)`);
		for (const ref of pinRefs(pins)) {
			if (nodes[ref]) continue;
			const { lat, lon, tags } = resolveRef(ref, store, source, options);
			nodes[ref] = { ref, lat, lon, tags };
		}
	}
	return nodes;
}

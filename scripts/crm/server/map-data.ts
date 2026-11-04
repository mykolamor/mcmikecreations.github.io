// The Map tab's payload: the hike's map fields (post overrides applied), its route files, nodes, other hikes' checkpoints and photo locations.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { readStore } from '../lib/osm-store-file';
import { englishText } from '../../../src/lib/data/hikes-core.js';
import { clientDoc, loadDoc, type HikeDoc } from './doc';
import { bailoutRoutes, geojsonTarget, resolveGpxUrl, served } from './files';
import { effectiveTags, mainKind } from './osm-service';
import { assertSafeSlug, repoPaths } from './paths';

export type MapNode = { ref: string; name: string | null; kind: string | null; lat: number; lon: number; local?: Record<string, string | null> };
export type MapPayload = {
	version: string;
	origin: { lat: number; lon: number } | null;
	height: number | null;
	overrides: { origin: boolean; height: boolean; checkpoints: boolean };
	routeUrl: string | null;
	gpxUrl: string | null;
	bailouts: { route: string; url: string }[];
	checkpoints: [number, number][];
	nodes: MapNode[];
	others: { slug: string; name: string; checkpoints: [number, number][] }[];
	photos: { key: string; lat: number; lon: number; caption?: string }[];
};

const GPX_URL = '/_projects/data-viz/hikes/gpx/';

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hasValue = (v: unknown) => v !== undefined && v !== null;

function pairs(v: unknown): [number, number][] {
	if (!Array.isArray(v)) return [];
	return v.filter((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1])).map((c) => [c[0], c[1]] as [number, number]);
}

export function originOf(v: unknown): { lat: number; lon: number } | null {
	const o = v as { lat?: unknown; lon?: unknown } | null | undefined;
	return o && isNum(o.lat) && isNum(o.lon) ? { lat: o.lat, lon: o.lon } : null;
}

/** `<url>?v=<file mtime>`, or null when the file is missing. Not the doc version: a checkpoint edit must not make the browser re-download the route. */
function versioned(url: string | null, file: string | null): string | null {
	if (!url || !file || !existsSync(file)) return null;
	return `${url}?v=${Math.floor(statSync(file).mtimeMs)}`;
}

function captions(body: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)) {
		const key = m[2].split('/').pop()!;
		if (m[1] && !out.has(key)) out.set(key, m[1]);
	}
	return out;
}

/**
 * The map view as the post page uses it: origin, height and checkpoints (a post's override over the sidecar's, and
 * whether it is one), and the hike's node refs (hike-wide only). Only the doc's own fields: cheap enough to run per
 * request (the Write tab's places).
 */
export function mapView(doc: HikeDoc) {
	const f = clientDoc(doc).fields as Record<string, { hike?: unknown; post?: unknown }>;
	const pick = (id: string) => {
		const e = f[id] ?? {};
		const over = hasValue(e.post);
		return { value: over ? e.post : e.hike, over };
	};
	const refs: unknown = (f['map.nodes'] ?? {}).hike;
	return {
		origin: pick('map.origin'),
		height: pick('map.height'),
		checkpoints: pick('map.checkpoints'),
		refs: Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : []
	};
}

export function mapPayload(root: string, slug: string, date: string | null): MapPayload {
	assertSafeSlug(slug);
	const doc = loadDoc(root, slug, date);
	const p = repoPaths(root);
	const view = mapView(doc);
	const { origin: o, height: h, checkpoints: c } = view;

	let front: any = {};
	let body = '';
	if (doc.postRaw !== null) {
		const fm = readFrontmatterDoc(doc.postRaw);
		front = fm.doc.toJS() ?? {};
		body = fm.body;
	}

	const gpx = resolveGpxUrl(root, slug, front);
	const route = geojsonTarget(root, slug, front);
	const bailouts = bailoutRoutes(doc.sidecarRaw, doc.postRaw)
		.map((b) => ({ route: b.route, url: versioned(b.route, served(root, b.route, GPX_URL + 'bailouts/', p.bailouts)) }))
		.filter((b): b is { route: string; url: string } => b.url !== null);

	const store = existsSync(p.osmStore) ? readStore(p.osmStore) : {};
	const nodes: MapNode[] = [];
	for (const ref of view.refs) {
		const e = store[ref];
		if (!e || !isNum(e.lat) || !isNum(e.lon)) continue;
		const tags = effectiveTags(e);
		nodes.push({ ref, name: tags.name ?? null, kind: mainKind(tags), lat: e.lat, lon: e.lon, ...(e.local && Object.keys(e.local).length ? { local: e.local } : {}) });
	}

	const others: MapPayload['others'] = [];
	const photos: MapPayload['photos'] = [];
	if (existsSync(p.markdown)) {
		for (const file of readdirSync(p.markdown).sort()) {
			const m = /^(.+)\.hike\.json$/.exec(file);
			if (!m || m[1] === slug) continue;
			try {
				const j = parse(readFileSync(path.join(p.markdown, file), 'utf8')) as any;
				const cps = pairs(j?.checkpoints);
				const name = englishText(j?.name);
				if (cps.length) others.push({ slug: m[1], name: typeof name === 'string' && name ? name : m[1], checkpoints: cps });
			} catch {
				/* unreadable sidecar: skip */
			}
		}
	}
	const caps = captions(body);
	for (const [key, im] of Object.entries<any>(front.images ?? {})) {
		if (!im || !isNum(im.lat) || !isNum(im.lon)) continue;
		photos.push({ key, lat: im.lat, lon: im.lon, ...(caps.has(key) ? { caption: caps.get(key) } : {}) });
	}

	return {
		version: doc.version,
		origin: originOf(o.value),
		height: isNum(h.value) ? h.value : null,
		overrides: { origin: o.over, height: h.over, checkpoints: c.over },
		routeUrl: versioned(route?.url ?? null, route?.file ?? null),
		gpxUrl: gpx ? versioned(gpx.url, served(root, gpx.url, GPX_URL, p.gpx)) : null,
		bailouts,
		checkpoints: pairs(c.value),
		nodes,
		others,
		photos
	};
}

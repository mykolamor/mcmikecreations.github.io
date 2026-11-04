// A doc's facts read the way the site's post page reads them (src/routes/hikes/[slug]/+page.server.ts): the same
// inputs from the files as they are on disk now, through the site's own `readHikeFacts`. The CRM never validates facts
// itself; the Facts tab, the problems and the library check all go through here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { loadHikesFrom, postResolverFor } from '../../load-hikes.js';
import { applyDateOverrides, readDateFields } from '../../../src/lib/data/hikes-core.js';
import { computeMetricScales, mergeMetrics } from '../../../src/lib/hikes/hike-metrics';
import { FactsError, readHikeFacts, type FactsNode } from '../../../src/lib/hikes/facts.server';
import { LIBRARY_KINDS, emptyFactsLibrary, type FactsLibrary } from '../../../src/lib/hikes/facts-library.server';
import type { HikeAuthoredFacts } from '../../../src/lib/hikes/facts-schema';
import { readFactsLibraryFile } from '../lib/facts-library-file';
import { ApiError } from './errors';
import type { DocRef, EnglishRef } from './doc-ref';
import { geojsonTarget } from './files';
import { repoPaths } from './paths';
import { renderInputs } from './preview';

export type DocFacts = {
	/** The merged facts; null when they can't be read (`error`) or the doc has none. */
	facts: HikeAuthoredFacts | null;
	warnings: string[];
	/** The site's `FactsError` message, when the facts would fail the build. */
	error: string | null;
	/** The route's coordinates as the page draws them; empty without a route file. */
	coords: number[][];
	distanceFactor: number;
	/** The hike's own nodes, those in the store. */
	nodeRefs: string[];
};

type RouteGeo = { coords: number[][] | null; distanceFactor: number };

/** The library file as the build reads it; none is an empty library. */
export function libraryOf(root: string): FactsLibrary {
	return existsSync(repoPaths(root).factsLibrary) ? readFactsLibraryFile(root) : emptyFactsLibrary();
}

/**
 * The route as the page reads it: the GeoJSON's first feature, and the distance factor that maps its haversine length
 * onto the stated distance (a sidecar, hikes.json, front matter or date override wins over the GeoJSON's summary).
 */
function routeOf(root: string, ref: Extract<DocRef, { kind: 'post' | 'hike' }>, front: Record<string, unknown> | null): RouteGeo {
	const target = geojsonTarget(root, ref.slug, front ?? {});
	if (!target || !existsSync(target.file)) return { coords: null, distanceFactor: 1 };
	let feature: any;
	try {
		feature = JSON.parse(readFileSync(target.file, 'utf8'))?.features?.[0];
	} catch {
		return { coords: null, distanceFactor: 1 };
	}
	if (!feature?.properties) return { coords: null, distanceFactor: 1 };
	const coords: number[][] | null = feature.geometry?.coordinates ?? null;
	if (!coords) return { coords, distanceFactor: 1 };
	const p = repoPaths(root);
	let overrides: Record<string, any> = {};
	try {
		const hike = loadHikesFrom(p.static, p.hikesJson, { fresh: true }).find((h: any) => h.route.split('/').pop() === ref.slug);
		const date = ref.kind === 'post' ? hike?.properties.dates.find((d: any) => d.date === ref.date) : null;
		if (hike) {
			const resolved = date ? postResolverFor(p.static)(hike, date) : hike;
			overrides = date ? applyDateOverrides(resolved.properties, { ...date, ...readDateFields(front) }) : resolved.properties;
		}
	} catch {
		/* another hike fails the build (Problems lists it): no override is known here */
	}
	return { coords, distanceFactor: computeMetricScales(coords, { ...overrides, ...mergeMetrics(overrides, feature.properties) }).distanceFactor };
}

/**
 * The doc's facts: the sidecar's route defaults with the post's own merged on top, places resolved on the route, as
 * the page reads them. A `draft` replaces that file's `facts` (`undefined` keeps the file's own), so an unsaved edit
 * can be read before it is written. A `FactsError` is `error` with no facts; any other failure propagates.
 */
export function readDocFacts(root: string, ref: EnglishRef, opts: { draft?: { hike?: unknown; post?: unknown }; library?: FactsLibrary } = {}): DocFacts {
	if (ref.kind === 'place') throw new ApiError(400, 'A place doc has no facts');
	const p = repoPaths(root);
	const inputs = renderInputs(root, ref);
	const nodes = inputs.nodes as FactsNode[];
	const own = new Set(inputs.ownRefs);
	const date = ref.kind === 'post' ? ref.date : null;
	const sidecarSource = `${ref.slug}.hike.json`;
	const { draft } = opts;
	const post = draft?.post !== undefined ? draft.post : date ? inputs.front?.facts : undefined;
	const sidecar = draft?.hike !== undefined ? draft.hike : (parse(readFileSync(path.join(p.markdown, sidecarSource), 'utf8')) ?? {}).facts;
	const route = routeOf(root, ref, inputs.front);
	const base = { coords: route.coords ?? [], distanceFactor: route.distanceFactor, nodeRefs: inputs.ownRefs };
	try {
		const { facts, warnings } = readHikeFacts({
			post, sidecar, postSource: date ? `${date}-${ref.slug}.md` : sidecarSource, sidecarSource,
			nodes: nodes.filter((n) => n.ref != null && own.has(n.ref)), storeNodes: nodes,
			origin: inputs.origin, height: inputs.height, ownRefs: inputs.ownRefs,
			coords: route.coords, distanceFactor: route.distanceFactor,
			library: opts.library ?? libraryOf(root),
			// Bailout routes are served files under static/, as the site build reads them.
			readGpx: (served) => {
				const file = path.join(p.static, served);
				return existsSync(file) ? readFileSync(file, 'utf8') : null;
			}
		});
		return { facts, warnings, error: null, ...base };
	} catch (e) {
		if (!(e instanceof FactsError)) throw e;
		return { facts: null, warnings: [], error: e.message, ...base };
	}
}

/** Every doc the build reads facts for: each post, and a hike with no post on its own; `name` is `<date>-<slug>` or `<slug>`. */
export function factsDocs(root: string): { name: string; file: string; ref: Extract<DocRef, { kind: 'post' | 'hike' }> }[] {
	const p = repoPaths(root);
	const names = existsSync(p.markdown) ? readdirSync(p.markdown) : [];
	return names.filter((f) => f.endsWith('.hike.json')).sort().flatMap((sidecar): ReturnType<typeof factsDocs> => {
		const slug = sidecar.slice(0, -'.hike.json'.length);
		const dates = names.flatMap((f) => { const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(f); return m && m[2] === slug ? [m[1]] : []; }).sort();
		if (!dates.length) return [{ name: slug, file: path.join(p.markdown, sidecar), ref: { kind: 'hike', slug } }];
		return dates.map((date) => ({ name: `${date}-${slug}`, file: path.join(p.markdown, `${date}-${slug}.md`), ref: { kind: 'post', slug, date } }));
	});
}

/** The library, calling `take` with `"<kind>/<id>"` for every record the facts reader looks up and finds. */
export function watchedLibrary(library: FactsLibrary, take: (key: string) => void): FactsLibrary {
	const kinds = LIBRARY_KINDS.map((kind) => [kind, new Proxy(library[kind], {
		get(records, id, receiver) {
			if (typeof id === 'string' && Object.hasOwn(records, id)) take(`${kind}/${id}`);
			return Reflect.get(records, id, receiver);
		}
	})]);
	return Object.fromEntries(kinds) as FactsLibrary;
}

/**
 * For each record of the library (`"<kind>/<id>"`), the docs whose reading takes it (a `use`, or a stop's place), read
 * as the build reads them (factsDocs); a record no doc takes has none. A doc whose facts can't be read counts for the
 * records it took before it failed.
 */
export function libraryUsage(root: string): Record<string, string[]> {
	const library = libraryOf(root);
	const usage: Record<string, Set<string>> = {};
	for (const kind of LIBRARY_KINDS) for (const id of Object.keys(library[kind])) usage[`${kind}/${id}`] = new Set();
	for (const doc of factsDocs(root)) {
		try {
			readDocFacts(root, doc.ref, { library: watchedLibrary(library, (key) => usage[key]?.add(doc.name)) });
		} catch {
			/* unreadable front matter: Problems says so */
		}
	}
	return Object.fromEntries(Object.entries(usage).map(([key, docs]) => [key, [...docs]]));
}

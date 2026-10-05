/**
 * The glob-free core of the hike database: every rule for turning sidecars,
 * posts and `hikes.json` into hikes, and for resolving a hike as one of its
 * dates or posts sees it.
 *
 * Plain JS on purpose, so the site (`hikes-db`, `hikes.server`,
 * `frontmatter.server`) and the Node scripts (`scripts/load-hikes.js`) share one
 * copy. Anything that needs a file — a sidecar's contents, whether a GPX exists —
 * comes in as a lookup, since the site answers it from `import.meta.glob` and
 * Node from the disk. Dependency-free and browser-safe.
 */

/**
 * @typedef {import('./map-info').Map} Hike
 * @typedef {import('./map-info').MapDate} MapDate
 * @typedef {import('./map-info').MapProperties} MapProperties
 * @typedef {import('./map-info').HikeMeta} HikeMeta
 * @typedef {import('./map-info').OriginData} OriginData
 * @typedef {Record<string, unknown>} Dict
 * @typedef {(metaPath: string) => HikeMeta | undefined} MetaLookup
 * @typedef {(path: string) => boolean} GpxLookup
 */

export const metaFolder = '/_projects/data-viz/hikes/markdown';
export const geoFolder = '/_projects/data-viz/hikes/geojson';
export const routeFolder = '/projects/data-viz/hikes';

/** `2025-03-02-seekarkreuz.md` -> date `2025-03-02`, slug `seekarkreuz`. */
export const POST_FILE = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

/**
 * Front-matter keys that set fields on the hike itself.
 *
 * `name` has a post-level counterpart in `title`, so both survive flattening.
 * The hike's own `description` and `image` do not — those keys mean the post's,
 * below — so a route's shared text lives in its `<slug>.hike.json` sidecar.
 */
export const HIKE_KEYS = new Set(['name', 'height']);

/** Front-matter keys that set fields on the hike's `properties`. */
export const PROPS_KEYS = new Set(['draft', 'hidden', 'checkpoints', 'nodes']);

/**
 * Front-matter keys that set fields on this post's date entry.
 *
 * `filePath` and the four metrics exist at both levels in `hikes.json`, with the
 * same meaning; flattened they land here, the more specific level, which is
 * where they already won from.
 */
export const DATE_KEYS = new Set([
	'title',
	'description',
	'image',
	'tags',
	'people',
	'author',
	'gpx',
	'filePath',
	'metaPath',
	'distance',
	'duration',
	'ascent',
	'descent'
]);

/** The four metrics a date may pin for itself, overriding the hike's. */
export const DATE_METRICS = /** @type {const} */ (['distance', 'duration', 'ascent', 'descent']);

/**
 * @param {unknown} value
 * @returns {value is Dict}
 */
function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function readString(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Route slug, e.g. `/projects/data-viz/hikes/seekarkreuz` -> `seekarkreuz`.
 * @param {string} route
 */
export function hikeSlug(route) {
	return route.substring(route.lastIndexOf('/') + 1);
}

/**
 * The page a hike lives at.
 * @param {string} slug
 */
export function hikeRoute(slug) {
	return `${routeFolder}/${slug}`;
}

/**
 * Where a hike's sidecar lives unless something says otherwise.
 * @param {string} slug
 */
export function defaultMetaPath(slug) {
	return `${metaFolder}/${slug}.hike.json`;
}

/**
 * Where a hike's route GeoJSON lives unless something says otherwise.
 * @param {string} slug
 */
export function defaultFilePath(slug) {
	return `${geoFolder}/${slug}.json`;
}

/**
 * Where a route's GPX track lives by convention, derived from its GeoJSON path.
 * @param {string} filePath
 */
export function defaultGpxPath(filePath) {
	return filePath.replace('geojson', 'gpx').replace('json', 'gpx');
}

/**
 * Fold a sidecar into a hike, in the key order `hikes.json` used to have.
 *
 * The sidecar owns its seven fields outright: swapping one in replaces them all,
 * including dropping `nodes` again if the new sidecar declares none.
 *
 * @param {{ route: string; properties: MapProperties }} hike
 * @param {HikeMeta} meta
 * @returns {Hike}
 */
export function withHikeMeta(hike, meta) {
	/** @type {MapProperties} */
	const properties = { ...hike.properties, checkpoints: meta.checkpoints };
	if (meta.nodes === undefined) delete properties.nodes;
	else properties.nodes = meta.nodes;

	return {
		name: meta.name,
		image: meta.image,
		properties,
		description: meta.description,
		route: hike.route,
		height: meta.height,
		standardFeatures: { origin: meta.origin }
	};
}

/**
 * Promote a date's own `filePath` / metric overrides into a hike's properties.
 *
 * Returns `properties` unchanged (same reference) when the date overrides
 * nothing.
 *
 * @param {MapProperties} properties
 * @param {MapDate} date
 * @returns {MapProperties}
 */
export function applyDateOverrides(properties, date) {
	/** @type {MapProperties | null} */
	let out = null;
	const claim = () => (out ??= { ...properties });

	if (date.filePath) claim().filePath = date.filePath;
	for (const key of DATE_METRICS) {
		if (date[key] != null) claim()[key] = date[key];
	}

	return out ?? properties;
}

/**
 * The hike as one of its dates sees it: the date's `metaPath` sidecar swapped in
 * and its `filePath` / metric overrides promoted.
 *
 * A blogged date already carries its post's front-matter fields, folded in when
 * the model was built, so this covers front matter too for everything at date
 * level. Hike-level front-matter keys still need `applyPostOverrides`.
 *
 * @param {Hike} hike
 * @param {MapDate} date
 * @param {MetaLookup} getHikeMeta
 * @returns {Hike}
 */
export function resolveHikeForDate(hike, date, getHikeMeta) {
	let base = hike;

	if (date.metaPath) {
		const meta = getHikeMeta(date.metaPath);
		if (!meta) {
			throw new Error(
				`Unknown sidecar "${date.metaPath}" on date ${date.date} of hike route "${hike.route}"`
			);
		}
		base = withHikeMeta(base, meta);
	}

	const properties = applyDateOverrides(base.properties, date);
	return properties === base.properties ? base : { ...base, properties };
}

/**
 * Which sidecar this post wants, if it wants one other than the hike's own:
 * front matter first, then the date's `metaPath` in `hikes.json`. A hike-level
 * `properties.metaPath` needs no mention — `assembleHikes` has already applied
 * it. Returns null when nothing overrides it.
 *
 * @param {Dict | null | undefined} frontmatter
 * @param {MapDate} date
 * @returns {string | null}
 */
export function readMetaPathOverride(frontmatter, date) {
	const fm = isPlainObject(frontmatter) ? frontmatter : undefined;
	return readString(fm?.metaPath) ?? readString(date.metaPath);
}

/**
 * The date-level fields a post's front matter declares, used to fold a post into
 * the model so downstream code can read `date.title`, `date.tags` and friends
 * without knowing front matter exists.
 *
 * @param {Dict | null | undefined} frontmatter
 * @returns {Partial<MapDate>}
 */
export function readDateFields(frontmatter) {
	/** @type {Dict} */
	const out = {};
	if (!isPlainObject(frontmatter)) return out;
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === null || value === undefined) continue;
		if (DATE_KEYS.has(key)) out[key] = value;
	}
	return /** @type {Partial<MapDate>} */ (out);
}

/**
 * Validate a front-matter `origin`. Throws rather than letting a malformed one
 * through, since a bad centre silently mis-projects the whole map.
 *
 * @param {unknown} value
 * @param {string} route
 * @returns {OriginData | null}
 */
function readOrigin(value, route) {
	if (value === null || value === undefined) return null;
	if (!isPlainObject(value) || typeof value.lat !== 'number' || typeof value.lon !== 'number') {
		throw new Error(
			`Front matter origin for hike route "${route}" must be { lat: <number>, lon: <number> }`
		);
	}
	return { lat: value.lat, lon: value.lon };
}

/**
 * Everything one post's front matter can change, in the right order.
 *
 * The single definition of that order, so the post page, the aggregate views
 * and the Node scripts cannot drift:
 *
 *  1. swap in the sidecar the post asks for, if any — first, so a post that also
 *     sets one of the sidecar's own fields by hand keeps its own value;
 *  2. route each flat key to its level and merge;
 *  3. promote the date's `filePath` and pinned metrics into `properties`.
 *
 * `properties` is the effective set to read metrics and geometry from; the
 * returned `hike` still carries the pre-promotion `properties`, so callers that
 * want the merged view should use the `properties` field.
 *
 * Throws on a `metaPath` that names no known sidecar, rather than quietly
 * rendering the wrong map.
 *
 * @param {Hike} hike
 * @param {MapDate} date
 * @param {Dict | null | undefined} frontmatter
 * @param {MetaLookup} getHikeMeta
 * @returns {{ hike: Hike; date: MapDate; properties: MapProperties }}
 */
export function applyPostOverrides(hike, date, frontmatter, getHikeMeta) {
	let base = hike;

	const metaPath = readMetaPathOverride(frontmatter, date);
	if (metaPath) {
		const meta = getHikeMeta(metaPath);
		if (!meta) {
			throw new Error(`Unknown sidecar "${metaPath}" for hike route "${hike.route}"`);
		}
		base = withHikeMeta(base, meta);
	}

	const fm = isPlainObject(frontmatter) ? frontmatter : {};

	/** @type {Dict} */
	const hikeOverrides = {};
	/** @type {Dict} */
	const propsOverrides = {};
	/** @type {Dict} */
	const dateOverrides = {};
	for (const [key, value] of Object.entries(fm)) {
		if (value === null || value === undefined) continue;
		if (DATE_KEYS.has(key)) dateOverrides[key] = value;
		else if (PROPS_KEYS.has(key)) propsOverrides[key] = value;
		else if (HIKE_KEYS.has(key)) hikeOverrides[key] = value;
	}

	const origin = readOrigin(fm.origin, hike.route);

	/** @type {Hike} */
	const mergedHike = {
		...base,
		...hikeOverrides,
		...(origin ? { standardFeatures: { origin } } : {}),
		properties: { ...base.properties, ...propsOverrides }
	};
	/** @type {MapDate} */
	const mergedDate = { ...date, ...dateOverrides };

	return {
		hike: mergedHike,
		date: mergedDate,
		properties: applyDateOverrides(mergedHike.properties, mergedDate)
	};
}

/**
 * The hike as one post sees it, front matter included — the same resolution the
 * post page performs. A date with no front matter (no post) gets just its own
 * date-level overrides.
 *
 * @param {Hike} hike
 * @param {MapDate} date
 * @param {Dict | null | undefined} frontmatter
 * @param {MetaLookup} getHikeMeta
 * @returns {{ hike: Hike; properties: MapProperties }}
 */
export function resolveHikeForPost(hike, date, frontmatter, getHikeMeta) {
	if (!frontmatter) {
		return { hike, properties: applyDateOverrides(hike.properties, date) };
	}
	const { hike: merged, properties } = applyPostOverrides(hike, date, frontmatter, getHikeMeta);
	return { hike: merged, properties };
}

/**
 * A date's GPX link: whatever front matter or `hikes.json` named, or else the
 * conventional path next to the route GeoJSON — but only when that file
 * actually exists, so a hike with no track recorded doesn't get a dead link.
 *
 * @param {MapDate} date
 * @param {string} hikeFilePath
 * @param {GpxLookup} hasGpxFile
 * @returns {MapDate}
 */
export function withDefaultGpx(date, hikeFilePath, hasGpxFile) {
	if (date.gpx) return date;
	const gpxPath = defaultGpxPath(date.filePath ?? hikeFilePath);
	return hasGpxFile(gpxPath) ? { ...date, gpx: gpxPath } : date;
}

/**
 * Dates newest first.
 * @param {{ date: string }} a
 * @param {{ date: string }} b
 */
export function compareDatesNewestFirst(a, b) {
	return a.date > b.date ? -1 : a.date < b.date ? 1 : 0;
}

/**
 * Hikes newest first by their most recent date, then by route — the order the
 * rest of the site presents them in.
 * @param {Hike} a
 * @param {Hike} b
 */
export function compareHikesNewestFirst(a, b) {
	const da = a.properties.dates[0].date;
	const db = b.properties.dates[0].date;
	if (da !== db) return da > db ? -1 : 1;
	return a.route < b.route ? -1 : 1;
}

/**
 * Assemble every hike from its three sources:
 *
 *  - `slugs` — one per `<slug>.hike.json` sidecar, the definitive list of hikes;
 *  - `posts` — one per `<date>-<slug>.md`: its file name, served path and parsed
 *    front matter;
 *  - `overrides` — the `hikes.json` entries, which carry only what neither of
 *    those can say.
 *
 * Throws on a post or `hikes.json` entry with no sidecar, on a hike with no
 * dates, and on a post file that breaks the naming convention.
 *
 * @param {{
 *   slugs: string[];
 *   posts: Array<{ file: string; path: string; frontmatter: Dict }>;
 *   overrides: Array<{ route: string; properties: Partial<MapProperties> }>;
 *   getHikeMeta: MetaLookup;
 *   hasGpxFile: GpxLookup;
 * }} sources
 * @returns {Hike[]} newest first
 */
export function assembleHikes({ slugs, posts, overrides, getHikeMeta, hasGpxFile }) {
	/** @type {Record<string, MapDate[]>} */
	const postsBySlug = {};
	for (const { file, path, frontmatter } of posts) {
		const match = POST_FILE.exec(file);
		if (!match) {
			throw new Error(`Hike post "${file}" is not named <date>-<slug>.md`);
		}
		const [, date, slug] = match;

		// The post's own fields, folded onto the date so everything downstream can
		// keep reading `date.title`, `date.tags` and friends as it always has.
		(postsBySlug[slug] ??= []).push(
			/** @type {MapDate} */ ({ date, path, tags: [], people: [], ...readDateFields(frontmatter) })
		);
	}

	/** @type {Record<string, Partial<MapProperties>>} */
	const overrideBySlug = {};
	for (const entry of overrides) {
		overrideBySlug[hikeSlug(entry.route)] = entry.properties;
	}

	for (const slug of Object.keys(postsBySlug)) {
		if (!slugs.includes(slug)) {
			throw new Error(`Hike post for "${slug}" has no ${slug}.hike.json sidecar`);
		}
	}
	for (const entry of overrides) {
		if (!slugs.includes(hikeSlug(entry.route))) {
			throw new Error(`hikes.json route "${entry.route}" has no sidecar`);
		}
	}

	/** @param {string} slug */
	const buildHike = (slug) => {
		const props = overrideBySlug[slug] ?? {};

		const metaPath = props.metaPath ?? defaultMetaPath(slug);
		const meta = getHikeMeta(metaPath);
		if (!meta) {
			throw new Error(`Missing sidecar "${metaPath}" for hike "${slug}"`);
		}

		const filePath = props.filePath ?? defaultFilePath(slug);
		const dates = [
			...(postsBySlug[slug] ?? []),
			// A date with no post: fill in the array defaults `hikes.json` no longer stores.
			...(props.dates ?? []).map((d) => ({ ...d, tags: d.tags ?? [], people: d.people ?? [] }))
		]
			.map((date) => withDefaultGpx(date, filePath, hasGpxFile))
			.sort(compareDatesNewestFirst);
		if (dates.length === 0) {
			throw new Error(`Hike "${slug}" has no dates: no post, and none in hikes.json`);
		}

		/** @type {MapProperties} */
		const properties = {
			...props,
			filePath,
			draft: props.draft ?? false,
			dates
		};

		return withHikeMeta({ route: hikeRoute(slug), properties }, meta);
	};

	return slugs.map(buildHike).sort(compareHikesNewestFirst);
}

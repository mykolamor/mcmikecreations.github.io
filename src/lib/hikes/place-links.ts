/**
 * Matches the place references in a post (`Knorrhütte (2052 m)`) to OSM
 * nodes (the whole store, on the server), so they can link to the node on the
 * 2D map.
 *
 * A reference matches a node when its trailing words equal one of the node's
 * names, ignoring case, accents, `ß`/`ss`, hyphens and spaces: "Approaching
 * Knorrhütte" matches the node "Knorrhütte", leaving "Approaching" as plain
 * text, and "Auer Berg" matches "Auerberg". Failing that, it matches when the
 * node's name ends with those words (whole words, however they're spaced) and
 * the node's `ele` is within 5 m of the reference's elevation: "Tovre (1913 m)"
 * matches "Palon de Tovre", but only at that height.
 *
 * Framework-free and dependency-free, so it runs under plain Node for tests.
 */

export interface PlaceNode {
	lat: number;
	lon: number;
	tags?: Record<string, unknown> | null;
}

export interface PlaceMatch {
	/** Index of the first name word that is part of the match. */
	start: number;
	node: PlaceNode;
}

export interface PlaceIndex {
	/**
	 * @param words The reference's name words, without the `(1234 m)` part.
	 * @param ele The reference's elevation in metres.
	 */
	match(words: string[], ele: number): PlaceMatch | null;
}

const NAME_TAGS = ['name', 'name:de', 'name:en', 'name:cs', 'alt_name', 'short_name', 'official_name'];
/** How far a node's `ele` may be from the reference's elevation for a partial name match. */
const ELE_TOLERANCE_M = 5;
/**
 * How far a whole-name node's `ele` may be from the reference's when no node is
 * at its height: rounding and typos link, another peak of the same name does not.
 */
const EXACT_ELE_TOLERANCE_M = 100;

/** Lowercase, `ß` as `ss`, accents dropped, hyphens and runs of space as one space. */
export function normalizePlaceName(name: string): string {
	return name
		.toLowerCase()
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[-‐‑–]/g, ' ')
		.replace(/[’`]/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/** `normalizePlaceName` without any spaces: "Auer Berg", "Auer-Berg" and "Auerberg" are one name. */
export function compactPlaceName(name: string): string {
	return normalizePlaceName(name).replace(/ /g, '');
}

/** Adds `name` (compacted) to `byName` unless an earlier entry has it: the first name wins. */
export function addPlaceName<T>(byName: Map<string, T>, name: string, value: T): void {
	const key = compactPlaceName(name);
	if (key && !byName.has(key)) byName.set(key, value);
}

/** The entry the words end with, longest trailing run first, and the index of its first word. */
export function matchTrailingWords<T>(words: string[], byName: Map<string, T>): { start: number; value: T } | null {
	for (let start = 0; start < words.length; start++) {
		const value = byName.get(compactPlaceName(words.slice(start).join(' ')));
		if (value) return { start, value };
	}
	return null;
}

function nodeNames(node: PlaceNode): string[] {
	const tags = node.tags ?? {};
	return NAME_TAGS.map((k) => tags[k]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** The node's `ele` tag in metres ("1706", "1706 m", "1706.5"), or null. */
export function nodeEle(node: PlaceNode): number | null {
	const raw = node.tags?.ele;
	const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : NaN;
	return Number.isFinite(value) ? value : null;
}

export interface PlaceIndexOptions {
	/**
	 * The hike's map centre. When several nodes share a name, the one nearest
	 * to it wins; without it, the first one in `nodes` does.
	 */
	origin?: { lat: number; lon: number } | null;
	/**
	 * The hike's map `height` in px. With `origin`, nodes outside the map's tile
	 * square are left out of the index, so a link never pans the map to where
	 * there are no tiles.
	 */
	height?: number | null;
	/**
	 * Refs of the hike's own nodes (the ones its map draws): exempt from the
	 * tile-square cutoff, wherever they are.
	 */
	keepRefs?: Iterable<string> | null;
}

/** Metres per px of the map at the equator (scripts/map-download.js: mercator scale 2^21/(2π)). */
const METRES_PER_PX_AT_EQUATOR = 40075016.686 / 2 ** 21;
const METRES_PER_DEGREE = 111194.9266;

/**
 * Whether the node lies inside the `height`×`height` px tile square centred on
 * `origin` (mercator at scale 2^21/(2π), as the map tiles are downloaded):
 * both its north and east offsets, in equirectangular metres, are within half
 * the side.
 */
export function insideTileSquare(node: PlaceNode, origin: { lat: number; lon: number }, height: number): boolean {
	const cosLat = Math.cos((origin.lat * Math.PI) / 180);
	const half = (height / 2) * METRES_PER_PX_AT_EQUATOR * cosLat;
	const north = (node.lat - origin.lat) * METRES_PER_DEGREE;
	const east = (node.lon - origin.lon) * METRES_PER_DEGREE * cosLat;
	return Math.abs(north) <= half && Math.abs(east) <= half;
}

/**
 * An index over the given nodes (the hike's, or the whole OSM store), or null
 * when none has a name. Several nodes with the matching name: those whose `ele`
 * is within 5 m of the reference's are preferred, then the one nearest `origin`
 * (ties by `ref`). A whole name whose `ele` is off (or missing) yields to a
 * partial name at the reference's height.
 * With `origin` and `height`, only nodes inside the map's tile square count,
 * apart from the hike's own (`keepRefs`).
 * Picking among a subset that holds the winner gives the same winner, so a
 * re-parse with just the matched nodes links the same places.
 */
export function buildPlaceIndex(nodes: PlaceNode[] | null | undefined, options: PlaceIndexOptions = {}): PlaceIndex | null {
	const exact = new Map<string, PlaceNode[]>();
	// For the elevation-checked rule: each name's trailing whole words, compacted.
	// "Palon de Tovre" gives "detovre" and "tovre", never "ovre".
	const partial: { tail: string; ele: number; node: PlaceNode }[] = [];
	const { origin: squareOrigin, height } = options;
	const keep = new Set(options.keepRefs ?? []);
	const square = squareOrigin && typeof height === 'number' && height > 0 ? { origin: squareOrigin, height } : null;
	for (const node of nodes ?? []) {
		if (typeof node?.lat !== 'number' || typeof node?.lon !== 'number') continue;
		if (square && !keep.has(String((node as { ref?: unknown }).ref)) && !insideTileSquare(node, square.origin, square.height)) continue;
		const ele = nodeEle(node);
		for (const name of nodeNames(node)) {
			const key = compactPlaceName(name);
			if (key) {
				const list = exact.get(key);
				if (!list) exact.set(key, [node]);
				else if (!list.includes(node)) list.push(node);
			}
			if (ele == null) continue;
			const nameWords = normalizePlaceName(name).split(' ');
			for (let i = 1; i < nameWords.length; i++) partial.push({ tail: nameWords.slice(i).join(''), ele, node });
		}
	}
	if (exact.size === 0) return null;

	const origin = options.origin;
	// Equirectangular distance², which is enough to compare nearby candidates.
	const cosLat = origin ? Math.cos((origin.lat * Math.PI) / 180) : 1;
	const distance = (node: PlaceNode) => {
		if (!origin) return 0;
		const dx = (node.lon - origin.lon) * cosLat;
		const dy = node.lat - origin.lat;
		return dx * dx + dy * dy;
	};
	// Ties (equal distance, or no origin at all) go by ref, then position, so
	// the winner never depends on the order of `nodes`.
	const tieKey = (node: PlaceNode) => (node as { ref?: unknown }).ref;
	const better = (a: PlaceNode, b: PlaceNode): boolean => {
		const da = distance(a);
		const db = distance(b);
		if (da !== db) return da < db;
		const ra = String(tieKey(a) ?? '');
		const rb = String(tieKey(b) ?? '');
		if (ra !== rb) return ra < rb;
		return a.lat !== b.lat ? a.lat < b.lat : a.lon < b.lon;
	};
	/** The candidate nearest to the origin. */
	const nearest = (candidates: PlaceNode[]): PlaceNode => {
		let best = candidates[0];
		for (const node of candidates) if (better(node, best)) best = node;
		return best;
	};
	const withinEle = (node: PlaceNode, ele: number) => {
		const own = nodeEle(node);
		return own != null && Math.abs(own - ele) <= ELE_TOLERANCE_M;
	};

	return {
		match(words, ele) {
			// Longest trailing run of words first, so "Hoher Kalmberg" beats
			// "Kalmberg". At each run, a whole name at the reference's height, then
			// a partial one at it. Only when no run has a node at that height does
			// a whole name at any height count: "Hinterer Kirchstein (1667 m)" is
			// the 1670 m "Vorderer Kirchstein" nearby rather than some
			// "Kirchstein" without a height in another valley.
			for (let start = 0; start < words.length; start++) {
				const key = compactPlaceName(words.slice(start).join(' '));
				const whole = (exact.get(key) ?? []).filter((node) => withinEle(node, ele));
				if (whole.length) return { start, node: nearest(whole) };
				const hits = partial.filter((p) => p.tail === key && Math.abs(p.ele - ele) <= ELE_TOLERANCE_M);
				if (hits.length) return { start, node: nearest(hits.map((p) => p.node)) };
			}
			// A reference without a height (NaN) takes any node. A node without a usable height, or within EXACT_ELE_TOLERANCE_M, may
			// stand in; a "Brauneck" 265 m lower is another place. The test is per
			// node, so a subset holding the winner picks it again.
			for (let start = 0; start < words.length; start++) {
				const candidates = (exact.get(compactPlaceName(words.slice(start).join(' '))) ?? []).filter((node) => {
					const own = nodeEle(node);
					return own == null || Number.isNaN(ele) || Math.abs(own - ele) <= EXACT_ELE_TOLERANCE_M;
				});
				if (candidates.length) return { start, node: nearest(candidates) };
			}
			return null;
		}
	};
}

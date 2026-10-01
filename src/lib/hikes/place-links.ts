/**
 * Matches the place references in a post (`Knorrhütte (2052 m)`) to the
 * hike's POI nodes, so they can link to the node on the 2D map.
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

const NAME_TAGS = ['name', 'name:de', 'name:en', 'alt_name', 'short_name', 'official_name'];
/** How far a node's `ele` may be from the reference's elevation for a partial name match. */
const ELE_TOLERANCE_M = 5;

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
function compactPlaceName(name: string): string {
	return normalizePlaceName(name).replace(/ /g, '');
}

function nodeNames(node: PlaceNode): string[] {
	const tags = node.tags ?? {};
	return NAME_TAGS.map((k) => tags[k]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** The node's `ele` tag in metres ("1706", "1706 m", "1706.5"), or null. */
function nodeEle(node: PlaceNode): number | null {
	const raw = node.tags?.ele;
	const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : NaN;
	return Number.isFinite(value) ? value : null;
}

/** An index over the hike's nodes, or null when none has a name. */
export function buildPlaceIndex(nodes: PlaceNode[] | null | undefined): PlaceIndex | null {
	const exact = new Map<string, PlaceNode>();
	// For the elevation-checked rule: each name's trailing whole words, compacted.
	// "Palon de Tovre" gives "detovre" and "tovre", never "ovre".
	const partial: { tail: string; ele: number; node: PlaceNode }[] = [];
	for (const node of nodes ?? []) {
		if (typeof node?.lat !== 'number' || typeof node?.lon !== 'number') continue;
		const ele = nodeEle(node);
		for (const name of nodeNames(node)) {
			const key = compactPlaceName(name);
			if (!exact.has(key)) exact.set(key, node);
			if (ele == null) continue;
			const nameWords = normalizePlaceName(name).split(' ');
			for (let i = 1; i < nameWords.length; i++) partial.push({ tail: nameWords.slice(i).join(''), ele, node });
		}
	}
	if (exact.size === 0) return null;

	return {
		match(words, ele) {
			// Longest trailing run of words first, so "Hoher Kalmberg" beats "Kalmberg".
			for (let start = 0; start < words.length; start++) {
				const node = exact.get(compactPlaceName(words.slice(start).join(' ')));
				if (node) return { start, node };
			}
			for (let start = 0; start < words.length; start++) {
				const key = compactPlaceName(words.slice(start).join(' '));
				const hit = partial.find((p) => p.tail === key && Math.abs(p.ele - ele) <= ELE_TOLERANCE_M);
				if (hit) return { start, node: hit.node };
			}
			return null;
		}
	};
}

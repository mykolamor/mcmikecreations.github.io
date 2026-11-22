/**
 * A blog post's `techTree` front matter: whether it is on the SmackDB tech tree (`/projects/smackdb/`) and where.
 * The block opts a post in; without it the post isn't on the tree.
 *
 * ```yaml
 * techTree:
 *   timelines: [query-processing]          # one or more timeline keys ($lib/tech-tree/timelines)
 *   year: 2011                             # year of the paper/technique → era column
 *   buildsOn: [2026-11-12-database-basics] # post anchors; optional
 *   row: 2                                 # optional manual row within its era
 *   intro: true                            # optional; `year` is a placement year, not shown
 * ```
 *
 * Framework-free; only checks the block's shape. Cross-post rules live in `model.ts`.
 */

export interface TechTreeEntry {
	timelines: string[];
	year: number;
	buildsOn: string[];
	row: number | null;
	intro: boolean;
}

const KEYS = new Set(['timelines', 'year', 'buildsOn', 'row', 'intro']);

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length > 0);
}

/** The parsed block, or null when `raw` is absent. Throws, naming `path`, on a malformed block. */
export function parseTechTree(raw: unknown, path: string): TechTreeEntry | null {
	if (raw === undefined || raw === null) return null;
	const fail = (why: string): never => {
		throw new Error(`${path}: techTree ${why}`);
	};
	if (typeof raw !== 'object' || Array.isArray(raw)) fail('must be a mapping');
	const block = raw as Record<string, unknown>;
	for (const key of Object.keys(block)) {
		if (!KEYS.has(key)) fail(`has an unknown key "${key}"`);
	}

	const { timelines, year, buildsOn = [], row = null, intro = false } = block;
	if (!isStringList(timelines) || timelines.length === 0) fail('timelines must be a non-empty list of timeline keys');
	const timelineList = timelines as string[];
	if (new Set(timelineList).size !== timelineList.length) fail('timelines lists a timeline twice');
	if (typeof year !== 'number' || !Number.isInteger(year)) fail('year must be an integer');
	if (!isStringList(buildsOn)) fail('buildsOn must be a list of post anchors');
	if (new Set(buildsOn as string[]).size !== (buildsOn as string[]).length) fail('buildsOn lists a post twice');
	if (row !== null && (typeof row !== 'number' || !Number.isInteger(row) || row < 0)) fail('row must be a non-negative integer');
	if (typeof intro !== 'boolean') fail('intro must be true or false');

	return {
		timelines: [...timelineList],
		year: year as number,
		buildsOn: [...(buildsOn as string[])],
		row: row as number | null,
		intro: intro as boolean
	};
}

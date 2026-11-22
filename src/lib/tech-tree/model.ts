/**
 * The SmackDB tech tree, validated: opted-in Databases posts (`techTree` front matter) placed into the configured
 * timelines and eras, with "builds on" arrows. Bad data throws, naming the post's file, so the build fails rather
 * than a node going missing.
 *
 * Framework-free.
 */

import type { Lang } from '$lib/i18n/languages';
import type { TechTreeEntry } from './front-matter';
import type { EraDef, TimelineDef } from './timelines';

export type Titles = { en: string } & Partial<Record<Lang, string>>;

export interface TreePostInput {
	anchor: string;
	path: string;
	draft: boolean;
	tags: string[];
	titles: Titles;
	techTree: TechTreeEntry | null;
}

export interface TreeNode {
	anchor: string;
	titles: Titles;
	/** `/blog/<anchor>/`; null for a draft (coming soon). */
	href: string | null;
	comingSoon: boolean;
	/** The paper's year; null for an intro post, whose year only places it. */
	year: number | null;
	/** Index into the timeline's eras. */
	era: number;
	/** Pinned row from front matter. */
	row: number | null;
}

export interface TreeEdge {
	from: string;
	to: string;
}

export interface TreeTimeline {
	key: string;
	eras: EraDef[];
	nodes: TreeNode[];
	edges: TreeEdge[];
}

export interface TechTree {
	timelines: TreeTimeline[];
}

const TAG = 'Databases';

function eraOf(eras: EraDef[], year: number): number {
	return eras.findIndex((e) => year >= e.from && (e.to === null || year <= e.to));
}

/** Throws, naming a file on the cycle, if `buildsOn` loops. */
function checkCycles(posts: Map<string, TreePostInput>): void {
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (anchor: string): void => {
		const s = state.get(anchor);
		if (s === 'done') return;
		const post = posts.get(anchor)!;
		if (s === 'visiting') throw new Error(`${post.path}: techTree buildsOn forms a cycle`);
		state.set(anchor, 'visiting');
		for (const dep of post.techTree!.buildsOn) visit(dep);
		state.set(anchor, 'done');
	};
	for (const anchor of posts.keys()) visit(anchor);
}

export function buildTechTree(posts: TreePostInput[], defs: TimelineDef[]): TechTree {
	const all = new Map(posts.map((p) => [p.anchor, p]));
	const onTree = new Map(posts.filter((p) => p.techTree).map((p) => [p.anchor, p]));
	const defByKey = new Map(defs.map((d) => [d.key, d]));

	for (const post of onTree.values()) {
		const tree = post.techTree!;
		if (!post.tags.includes(TAG)) throw new Error(`${post.path}: techTree is only for posts tagged ${TAG}`);
		for (const key of tree.timelines) {
			const def = defByKey.get(key);
			if (!def) throw new Error(`${post.path}: techTree timeline "${key}" isn't in $lib/tech-tree/timelines`);
			if (eraOf(def.eras, tree.year) < 0) throw new Error(`${post.path}: techTree year ${tree.year} is in no era of timeline "${key}"`);
		}
		for (const dep of tree.buildsOn) {
			if (!all.has(dep)) throw new Error(`${post.path}: techTree buildsOn "${dep}" matches no post`);
			if (!onTree.has(dep)) throw new Error(`${post.path}: techTree buildsOn "${dep}", which isn't on the tech tree`);
		}
	}
	checkCycles(onTree);

	const timelines: TreeTimeline[] = [];
	for (const def of defs) {
		const members = [...onTree.values()].filter((p) => p.techTree!.timelines.includes(def.key));
		if (members.length === 0) continue;
		const inTimeline = new Set(members.map((p) => p.anchor));
		const nodes: TreeNode[] = members
			.map((p) => {
				const tree = p.techTree!;
				return {
					anchor: p.anchor,
					titles: p.titles,
					href: p.draft ? null : `/blog/${p.anchor}/`,
					comingSoon: p.draft,
					year: tree.intro ? null : tree.year,
					era: eraOf(def.eras, tree.year),
					row: tree.row
				};
			})
			.sort((a, b) => onTree.get(a.anchor)!.techTree!.year - onTree.get(b.anchor)!.techTree!.year || a.titles.en.localeCompare(b.titles.en));
		const eraByAnchor = new Map(nodes.map((n) => [n.anchor, n.era]));
		const edges: TreeEdge[] = [];
		for (const n of nodes) {
			for (const dep of onTree.get(n.anchor)!.techTree!.buildsOn) {
				if (!inTimeline.has(dep)) continue;
				if (eraByAnchor.get(dep)! > n.era) {
					throw new Error(`${onTree.get(n.anchor)!.path}: techTree buildsOn "${dep}", which is in a later era of timeline "${def.key}"`);
				}
				edges.push({ from: dep, to: n.anchor });
			}
		}
		timelines.push({ key: def.key, eras: def.eras, nodes, edges });
	}
	return { timelines };
}

/** The node's title in `lang`, else English. */
export function nodeTitle(node: Pick<TreeNode, 'titles'>, lang: Lang): string {
	return node.titles[lang] ?? node.titles.en;
}

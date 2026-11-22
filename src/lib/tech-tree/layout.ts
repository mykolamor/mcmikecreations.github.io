/**
 * Grid layout for one tech tree timeline: era columns, split into sub-columns so a node that builds on another of
 * the same era sits to its right, and rows that follow incoming arrows. Deterministic; abstract grid units (the
 * component turns them into pixels).
 *
 * Framework-free.
 */

import type { TreeEdge, TreeNode, TreeTimeline } from './model';

export interface LaidOutNode extends TreeNode {
	col: number;
	gridRow: number;
}

export interface LaidOutEra {
	key: string;
	colStart: number;
	colSpan: number;
}

/** A cell an arrow passes through on its way across a column it doesn't stop in. */
export interface Waypoint {
	col: number;
	row: number;
}

/** An arrow that skips columns runs through free cells (`via`, left to right), never behind a card. */
export interface LaidOutEdge extends TreeEdge {
	via: Waypoint[];
}

export interface TimelineLayout {
	key: string;
	eras: LaidOutEra[];
	nodes: LaidOutNode[];
	edges: LaidOutEdge[];
	cols: number;
	rows: number;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** `path` maps an anchor to its file name, for error messages. */
export function layoutTimeline(tl: TreeTimeline, path: (anchor: string) => string): TimelineLayout {
	const byAnchor = new Map(tl.nodes.map((n) => [n.anchor, n]));
	const preds = new Map<string, string[]>(tl.nodes.map((n) => [n.anchor, []]));
	for (const e of tl.edges) preds.get(e.to)!.push(e.from);

	// Depth within an era: 1 + the deepest same-era predecessor (the model rules out cycles).
	const depth = new Map<string, number>();
	const depthOf = (anchor: string): number => {
		const known = depth.get(anchor);
		if (known !== undefined) return known;
		const node = byAnchor.get(anchor)!;
		const sameEra = preds.get(anchor)!.filter((p) => byAnchor.get(p)!.era === node.era);
		const d = sameEra.length === 0 ? 0 : 1 + Math.max(...sameEra.map(depthOf));
		depth.set(anchor, d);
		return d;
	};

	const eras: LaidOutEra[] = [];
	let colStart = 0;
	tl.eras.forEach((era, i) => {
		const inEra = tl.nodes.filter((n) => n.era === i);
		const colSpan = inEra.length === 0 ? 1 : 1 + Math.max(...inEra.map((n) => depthOf(n.anchor)));
		eras.push({ key: era.key, colStart, colSpan });
		colStart += colSpan;
	});
	const cols = colStart;
	const colOf = (n: TreeNode) => eras[n.era].colStart + depthOf(n.anchor);

	// Lanes: one free cell per (source, crossed column), shared by every long arrow from that source.
	const laneKey = (source: string, col: number) => `${source}@${col}`;
	const lanesIn = new Map<number, string[]>();
	for (const e of tl.edges) {
		const from = colOf(byAnchor.get(e.from)!);
		for (let c = from + 1; c < colOf(byAnchor.get(e.to)!); c++) {
			const lanes = lanesIn.get(c) ?? [];
			if (!lanes.includes(e.from)) lanes.push(e.from);
			lanesIn.set(c, lanes);
		}
	}

	// Nearest free row to `target` (lower one on a tie), or the lowest free row without one.
	const nearestFree = (taken: Set<number>, target: number | null): number => {
		if (target === null) {
			let row = 0;
			while (taken.has(row)) row++;
			return row;
		}
		for (let d = 0; ; d++) {
			if (target - d >= 0 && !taken.has(target - d)) return target - d;
			if (!taken.has(target + d)) return target + d;
		}
	};

	const gridRow = new Map<string, number>();
	const laneRow = new Map<string, number>();
	for (let col = 0; col < cols; col++) {
		const inCol = tl.nodes.filter((n) => colOf(n) === col);
		const taken = new Set<number>();
		const pinnedBy = new Map<number, string>();
		for (const n of inCol.filter((x) => x.row !== null)) {
			const other = pinnedBy.get(n.row!);
			if (other !== undefined) {
				throw new Error(`${path(other)} and ${path(n.anchor)}: techTree row ${n.row} is pinned twice in one column of timeline "${tl.key}"`);
			}
			pinnedBy.set(n.row!, n.anchor);
			taken.add(n.row!);
			gridRow.set(n.anchor, n.row!);
		}
		const barycenter = (n: TreeNode): number | null => {
			const rows = preds.get(n.anchor)!.map((p) => gridRow.get(p)).filter((r): r is number => r !== undefined);
			return rows.length === 0 ? null : rows.reduce((a, b) => a + b, 0) / rows.length;
		};
		const free = inCol
			.filter((x) => x.row === null)
			.map((n) => ({ n, bc: barycenter(n) }))
			.sort(
				(a, b) =>
					(a.bc ?? Infinity) - (b.bc ?? Infinity) ||
					(a.n.year ?? -Infinity) - (b.n.year ?? -Infinity) ||
					a.n.titles.en.localeCompare(b.n.titles.en)
			);
		for (const { n, bc } of free) {
			const row = nearestFree(taken, bc === null ? null : Math.round(bc));
			taken.add(row);
			gridRow.set(n.anchor, row);
		}
		// Lanes go after the cards, each as close as it can get to the row its arrow comes from.
		const lanes = (lanesIn.get(col) ?? [])
			.map((source) => ({ source, from: laneRow.get(laneKey(source, col - 1)) ?? gridRow.get(source)! }))
			.sort((a, b) => a.from - b.from || a.source.localeCompare(b.source));
		for (const { source, from } of lanes) {
			const row = nearestFree(taken, from);
			taken.add(row);
			laneRow.set(laneKey(source, col), row);
		}
	}

	const nodes = tl.nodes.map((n) => ({ ...n, col: colOf(n), gridRow: gridRow.get(n.anchor)! }));
	const edges: LaidOutEdge[] = tl.edges.map((e) => {
		const via: Waypoint[] = [];
		for (let c = colOf(byAnchor.get(e.from)!) + 1; c < colOf(byAnchor.get(e.to)!); c++) {
			via.push({ col: c, row: laneRow.get(laneKey(e.from, c))! });
		}
		return { ...e, via };
	});
	const rows = Math.max(0, ...nodes.map((n) => n.gridRow + 1), ...[...laneRow.values()].map((r) => r + 1));
	return { key: tl.key, eras, nodes, edges, cols, rows };
}

/**
 * An arrow from `from`'s right-middle to `to`'s left-middle: a cubic between neighbouring cells, straight across the
 * middle of each `via` cell.
 */
export function edgePath(from: Box, to: Box, via: Box[] = []): string {
	const curve = (x1: number, y1: number, x2: number, y2: number) => {
		const d = (x2 - x1) / 2;
		return `C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
	};
	let x = from.x + from.w;
	let y = from.y + from.h / 2;
	const parts = [`M ${x} ${y}`];
	for (const cell of via) {
		const cy = cell.y + cell.h / 2;
		parts.push(curve(x, y, cell.x, cy), `L ${cell.x + cell.w} ${cy}`);
		x = cell.x + cell.w;
		y = cy;
	}
	parts.push(curve(x, y, to.x, to.y + to.h / 2));
	return parts.join(' ');
}

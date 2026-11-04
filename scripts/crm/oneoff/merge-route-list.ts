// One-off: move each `difficulty.sections` entry into the `legs` route list.
// Idempotent. Run with:
//   JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}' node_modules/.bin/jiti scripts/crm/oneoff/merge-route-list.ts [--dry-run]
//
// A section becomes a profile-only entry (`inTable: false`, `onProfile: true`)
// after the legs, in the sections' order, as the build read it before. A
// section on exactly a leg's stretch merges into that leg instead (the leg gets
// `onProfile: true`), but only where the page stays the same:
// - the section's `to` is the leg's `to` and its `from` the leg's chained
//   start, both as written (the same string, or the same place object);
// - `sac`, `viaFerrata`, `climbing` and `note` are the same on both, or on
//   neither: the leg's table row and the section's band and Sections line show
//   them, so one side gaining a field changes the page;
// - the leg isn't optional (an optional entry doesn't count towards the grade)
//   and isn't on the profile already;
// - the profile entries keep their order, and the computed grade stays.
// Every pair kept apart is printed with its reason.
//
// Sidecars are edited as text, so every other byte stays (`784.0` too, which
// JSON.stringify would print as `784`); posts through lib/frontmatter.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNodeAtLocation, parseTree, type Node } from 'jsonc-parser';
import { isMap, isSeq, type Document } from 'yaml';
import { computedSac } from '$lib/hikes/facts.server';
import type { HikeAuthoredFacts } from '$lib/hikes/facts-schema';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { editSidecar, lineIndent } from '../server/sidecar-file';

type Entry = Record<string, unknown>;

export interface RouteListResult {
	changed: boolean;
	merged: number;
	appended: number;
	/** Per section, the index of the leg it merged into, or -1 when appended. */
	into: number[];
	/** The section/leg pairs on the same stretch that stay apart, with the reason. */
	apart: string[];
}

const GRADES = ['sac', 'viaFerrata', 'climbing', 'note'] as const;

const isObj = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys: two places are the same place object whatever their key order. */
function canonical(v: unknown): string {
	return JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)) ?? 'undefined';
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function placeLabel(p: unknown): string {
	if (p === undefined) return 'start/end';
	if (typeof p === 'string') return p;
	if (isObj(p)) {
		const name = isObj(p.name) ? p.name.en : p.name;
		if (typeof name === 'string') return name;
		if (typeof p.ref === 'string') return p.ref;
	}
	return JSON.stringify(p);
}

/** The computed overall grade of a raw route list, the defaults filled in. */
function grade(legs: Entry[]): string | undefined {
	const list = legs.map((l) => ({ ...l, inTable: l.inTable ?? true, onProfile: l.onProfile ?? false }));
	return computedSac({ legs: list } as unknown as HikeAuthoredFacts);
}

/**
 * Moves `facts.difficulty.sections` into `facts.legs` (in place), merging the
 * exact section/leg pairs that keep the page the same; removes the emptied
 * `sections` and `difficulty`. A no-op on facts without `difficulty.sections`.
 */
export function mergeRouteList(facts: Entry): RouteListResult {
	const result: RouteListResult = { changed: false, merged: 0, appended: 0, into: [], apart: [] };
	const d = facts.difficulty;
	if (!isObj(d) || !('sections' in d)) return result;
	const sections = Array.isArray(d.sections) ? (d.sections as Entry[]) : [];
	const legs = Array.isArray(facts.legs) ? (facts.legs as Entry[]) : [];

	// Each table leg's chained start, as written.
	const starts: unknown[] = [];
	let prev: unknown;
	for (const leg of legs) {
		starts.push(prev);
		if (leg.inTable ?? true) prev = leg.to;
	}

	// Profile entries in their page order: those already in the list, then the sections.
	let last = legs.reduce((at, l, i) => (l.onProfile === true ? i : at), -1);
	let appending = false;
	const into: number[] = [];
	const apart: string[] = [];
	for (const [n, s] of sections.entries()) {
		const at = legs.findIndex((l, i) => (l.inTable ?? true) && same(l.to, s.to) && same(starts[i], s.from));
		const pair = `section ${n} (${placeLabel(s.from)} → ${placeLabel(s.to)}) and legs[${at}]`;
		let why: string | undefined;
		if (at < 0) why = undefined;
		else if (into.includes(at)) why = 'the leg already took an earlier section';
		else if (legs[at].onProfile === true) why = 'the leg is on the profile already';
		else if (legs[at].optional === true) why = 'the leg is optional, so its grade doesn\'t count';
		else {
			const leg = legs[at];
			const differ = GRADES.filter((k) => !same(leg[k], s[k]));
			const both = differ.filter((k) => leg[k] !== undefined && s[k] !== undefined);
			if (both.length) why = `they differ in ${both.join(', ')}`;
			else if (differ.length) {
				why = differ.map((k) => (leg[k] === undefined ? `the leg's table row would gain the section's ${k}` : `the band would gain the leg's ${k}`)).join('; ');
			} else if (appending || at <= last) why = 'merging would move it ahead of an earlier profile entry';
		}
		if (at >= 0 && why === undefined) {
			into.push(at);
			last = at;
		} else {
			if (at >= 0) apart.push(`${pair}: ${why}`);
			into.push(-1);
			appending = true;
		}
	}

	const moved = sections.filter((_, n) => into[n] < 0).map((s) => ({ ...s, inTable: false, onProfile: true }));
	const next = (into: number[], moved: Entry[]) => [...legs.map((l, i) => (into.includes(i) ? { ...l, onProfile: true } : l)), ...moved];
	let list = next(into, moved);
	const before = grade([...legs, ...sections.map((s) => ({ ...s, inTable: false, onProfile: true }))]);
	if (into.some((i) => i >= 0) && grade(list) !== before) {
		for (const [n, i] of into.entries()) if (i >= 0) apart.push(`section ${n} and legs[${i}]: merging would change the computed grade`);
		into.fill(-1);
		list = next(into, sections.map((s) => ({ ...s, inTable: false, onProfile: true })));
	}

	if (list.length) facts.legs = list;
	const { sections: _, ...rest } = d;
	if (Object.keys(rest).length) facts.difficulty = rest;
	else delete facts.difficulty;
	result.changed = true;
	result.into = into;
	result.apart = apart;
	result.merged = into.filter((i) => i >= 0).length;
	result.appended = into.length - result.merged;
	return result;
}

/** Every number in the tree as written, sorted: `784.0` and `784` stay apart. */
function numberSpellings(text: string, node: Node | undefined): string[] {
	const out: string[] = [];
	const walk = (n: Node) => {
		if (n.type === 'number') out.push(text.slice(n.offset, n.offset + n.length));
		n.children?.forEach(walk);
	};
	if (node) walk(node);
	return out.sort();
}

/** `text`'s lines after the first, shifted left by `by` columns (or right, when negative). */
function shift(text: string, by: number): string {
	return text.split('\n').map((line, i) => (i === 0 ? line : by >= 0 ? line.slice(by) : ' '.repeat(-by) + line)).join('\n');
}

/** A sidecar's text with its route list merged; only the `facts` subtree changes. */
export function convertSidecar(raw: string): { text: string; result: RouteListResult } {
	const json = JSON.parse(raw) as Entry;
	const facts = json.facts;
	if (!isObj(facts)) return { text: raw, result: mergeRouteList({}) };
	const result = mergeRouteList(facts);
	if (!result.changed) return { text: raw, result };

	const root = parseTree(raw)!;
	const sectionNodes = findNodeAtLocation(root, ['facts', 'difficulty', 'sections'])?.children ?? [];
	let out = raw;
	// Merged legs: a flag spliced onto the leg's own text.
	for (const i of result.into) if (i >= 0) out = editSidecar(out, [{ path: ['facts', 'legs', i, 'onProfile'], value: true }]);
	// Appended sections: their own text, with the flags, moved to the end of the legs.
	const movedTexts = sectionNodes
		.filter((_, n) => result.into[n] < 0)
		.map((node) => ({ node, text: editSidecar(raw.slice(node.offset, node.offset + node.length), [{ path: ['inTable'], value: false }, { path: ['onProfile'], value: true }]) }));
	if (movedTexts.length) {
		const legsNode = findNodeAtLocation(parseTree(out)!, ['facts', 'legs']);
		const lastLeg = legsNode?.children?.at(-1);
		if (legsNode && lastLeg) {
			const indent = lineIndent(out, lastLeg.offset);
			const items = movedTexts.map(({ node, text }) => indent + shift(text, lineIndent(raw, node.offset).length - indent.length));
			const at = lastLeg.offset + lastLeg.length;
			out = out.slice(0, at) + ',\n' + items.join(',\n') + out.slice(at);
		} else {
			// No legs to follow: written fresh (number spellings are checked below).
			out = editSidecar(out, [{ path: ['facts', 'legs'], value: facts.legs }]);
		}
	}
	out = editSidecar(out, [{ path: isObj(facts.difficulty) ? ['facts', 'difficulty', 'sections'] : ['facts', 'difficulty'], value: undefined }]);

	const after = JSON.parse(out) as Entry;
	if (!same(after, json)) throw new Error('the written sidecar does not read back as the merged route list');
	const factsNode = (text: string) => findNodeAtLocation(parseTree(text)!, ['facts']);
	if (numberSpellings(raw, factsNode(raw)).join() !== numberSpellings(out, factsNode(out)).join()) {
		throw new Error('a number in facts changed its spelling');
	}
	return { text: out, result };
}

/** A post's text with its facts' route list merged, through the comment-keeping front-matter writer. */
export function convertPost(raw: string): { text: string; result: RouteListResult } {
	const { doc, body } = readFrontmatterDoc(raw);
	const factsNode = doc.get('facts', true);
	const facts = isMap(factsNode) ? (factsNode.toJSON() as Entry) : {};
	const result = mergeRouteList(facts);
	if (!result.changed) return { text: raw, result };
	applyToDoc(doc, result);
	const text = writeFrontmatterDoc(doc, body);
	const reread = readFrontmatterDoc(text).doc.get('facts', true);
	if (!same(isMap(reread) ? reread.toJSON() : {}, facts)) {
		throw new Error('the written post does not read back as the merged route list');
	}
	return { text, result };
}

function applyToDoc(doc: Document, result: RouteListResult): void {
	const sections = doc.getIn(['facts', 'difficulty', 'sections'], true);
	const items = isSeq(sections) ? sections.items : [];
	for (const i of result.into) if (i >= 0) doc.setIn(['facts', 'legs', i, 'onProfile'], true);
	const moved = items.filter((_, n) => result.into[n] < 0);
	for (const item of moved) {
		if (isMap(item)) {
			item.set('inTable', false);
			item.set('onProfile', true);
		}
	}
	if (moved.length) {
		const legs = doc.getIn(['facts', 'legs'], true);
		if (isSeq(legs)) legs.items.push(...moved);
		else doc.setIn(['facts', 'legs'], doc.createNode(moved));
	}
	doc.deleteIn(['facts', 'difficulty', 'sections']);
	const difficulty = doc.getIn(['facts', 'difficulty'], true);
	if (isMap(difficulty) && difficulty.items.length === 0) doc.deleteIn(['facts', 'difficulty']);
}

function main(): void {
	const dry = process.argv.includes('--dry-run');
	const dir = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/markdown/', import.meta.url));
	const totals = { files: 0, merged: 0, appended: 0 };
	const apart: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const convert = name.endsWith('.hike.json') ? convertSidecar : name.endsWith('.md') ? convertPost : null;
		if (!convert) continue;
		const file = path.join(dir, name);
		const raw = readFileSync(file, 'utf8');
		const { text, result } = convert(raw);
		apart.push(...result.apart.map((a) => `${name}: ${a}`));
		if (text === raw) continue;
		totals.files++;
		totals.merged += result.merged;
		totals.appended += result.appended;
		console.log(`${name}: ${result.merged} merged into a leg, ${result.appended} appended`);
		if (!dry) writeFileSync(file, text, 'utf8');
	}
	console.log(`${dry ? '[dry run] ' : ''}merge-route-list: ${totals.files} files changed; ${totals.merged} sections merged into a leg, ${totals.appended} appended to the route list`);
	if (apart.length) console.log(`kept apart (${apart.length}):\n${apart.map((a) => `  ${a}`).join('\n')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

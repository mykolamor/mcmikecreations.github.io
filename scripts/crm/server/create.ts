import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Document } from 'yaml';
import { writeFrontmatterDoc } from '../lib/frontmatter';
import { ApiError } from './errors';
import { postPath, sidecarPath } from './doc';
import type { HikesJsonEntry } from './hikes-index';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { editSidecar, type SidecarEdit } from './sidecar-file';

const ROUTE_PREFIX = '/projects/data-viz/hikes/';
const ROUTE_METRICS = ['ascent', 'descent', 'distance', 'duration'];

function writeNew(file: string, text: string): void {
	try {
		writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
	} catch (e: any) {
		if (e?.code === 'EEXIST') throw new ApiError(409, `Already exists: ${file}`);
		throw e;
	}
}

export function createHike(root: string, input: { slug: string; name: string; date: string }): { slug: string; date: string } {
	const slug = assertSafeSlug(input.slug);
	const date = assertSafeDate(input.date);
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name) throw new ApiError(400, 'name is required');
	if (existsSync(sidecarPath(root, slug))) throw new ApiError(409, `Hike ${slug} already exists`);
	if (existsSync(postPath(root, slug, date))) throw new ApiError(409, `Post ${date}-${slug} already exists`);
	const sidecar = JSON.stringify({ name, height: 512, checkpoints: [] }, null, 2) + '\n';
	writeNew(sidecarPath(root, slug), sidecar);
	writeNew(postPath(root, slug, date), '---\n---\n');
	return { slug, date };
}

/** Front-matter text for a new post carrying `fields` (empty -> `---\n---\n`). */
function frontMatterOf(fields: Record<string, unknown>): string {
	const doc = new Document({});
	for (const [k, v] of Object.entries(fields)) doc.set(k, doc.createNode(v));
	return writeFrontmatterDoc(doc, '');
}

export function createPost(root: string, input: { slug: string; date: string }): { slug: string; date: string } {
	const slug = assertSafeSlug(input.slug);
	const date = assertSafeDate(input.date);
	if (!existsSync(sidecarPath(root, slug))) throw new ApiError(404, `No sidecar for ${slug}`);
	const pp = postPath(root, slug, date);
	if (existsSync(pp)) throw new ApiError(409, `Post ${date}-${slug} already exists`);

	const fields: Record<string, unknown> = {};
	const edits: SidecarEdit[] = [];
	const hp = repoPaths(root).hikesJson;
	let raw = '';
	if (existsSync(hp)) {
		raw = readFileSync(hp, 'utf8');
		const entries = JSON.parse(raw) as HikesJsonEntry[];
		const i = entries.findIndex((e) => e.route === ROUTE_PREFIX + slug);
		const dates = i >= 0 ? (entries[i].properties.dates ?? []) : [];
		const j = dates.findIndex((d) => d.date === date);
		if (j >= 0) {
			const { date: _d, ...rest } = dates[j];
			const props = entries[i].properties;
			if (dates.length === 1) {
				// Last date: the route's metrics move into the post (date fields win); draft, hidden and
				// any other route property stay. The entry goes only when nothing but `dates` is left.
				const metrics = ROUTE_METRICS.filter((k) => props[k] !== undefined);
				for (const k of metrics) fields[k] = props[k];
				Object.assign(fields, rest);
				const leftover = Object.keys(props).filter((k) => k !== 'dates' && !metrics.includes(k as never));
				if (leftover.length === 0) edits.push({ path: [i], value: undefined });
				else {
					for (const k of metrics) edits.push({ path: [i, 'properties', k], value: undefined });
					edits.push({ path: [i, 'properties', 'dates', j], value: undefined });
				}
			} else {
				Object.assign(fields, rest);
				edits.push({ path: [i, 'properties', 'dates', j], value: undefined });
			}
		}
	}
	// The post is written first: a failure in between leaves a harmless duplicate date, never lost data.
	writeNew(pp, frontMatterOf(fields));
	if (edits.length) {
		const tmp = `${hp}.${process.pid}.tmp`;
		writeFileSync(tmp, editSidecar(raw, edits), 'utf8');
		renameSync(tmp, hp);
	}
	return { slug, date };
}

export const createVisitPost = createPost;

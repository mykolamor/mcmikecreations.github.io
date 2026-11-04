import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { ApiError } from './errors';
import { postPath, writeAtomic } from './doc';
import { filesState } from './files';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { setFrontmatterValue } from '../shared/ops';
import { trackMetrics, type TrackMetrics } from './track-metrics';

export const METRIC_KEYS = ['distance', 'ascent', 'descent', 'duration'] as const;

/** The four metrics as the post's front matter holds them now (hand-entered values included). */
export function currentMetrics(root: string, slug: string, date: string): Partial<Record<(typeof METRIC_KEYS)[number], number>> {
	assertSafeSlug(slug);
	assertSafeDate(date);
	const pp = postPath(root, slug, date);
	if (!existsSync(pp)) throw new ApiError(404, `No post ${date}-${slug}`);
	const front = (readFrontmatterDoc(readFileSync(pp, 'utf8')).doc.toJS() ?? {}) as Record<string, unknown>;
	const out: Partial<Record<(typeof METRIC_KEYS)[number], number>> = {};
	for (const k of METRIC_KEYS) if (typeof front[k] === 'number') out[k] = front[k] as number;
	return out;
}

/** What the recorded GPX gives; null for a planned track (no timestamps). 404 without a GPX, 422 for a file that isn't one. */
export async function computedMetrics(root: string, slug: string, date: string): Promise<TrackMetrics | null> {
	const st = await filesState(root, slug, date);
	if (!st.gpx) throw new ApiError(404, 'This post has no GPX recording');
	const file = path.join(repoPaths(root).static, st.gpx.path.slice(1));
	const text = readFileSync(file, 'utf8');
	if (!/<gpx[\s>]/.test(text)) throw new ApiError(422, `${st.gpx.path} is not a GPX file`);
	return trackMetrics(text);
}

/** Sets the given metrics in the post's front matter, touching only keys whose value differs; atomic. Returns whether the file changed. */
export function writeMetrics(root: string, slug: string, date: string, values: Partial<TrackMetrics>): boolean {
	const pp = postPath(root, slug, date);
	const raw = readFileSync(pp, 'utf8');
	const { doc, body } = readFrontmatterDoc(raw);
	for (const k of METRIC_KEYS) {
		const v = values[k];
		if (v !== undefined && doc.get(k) !== v) setFrontmatterValue(doc, [k], v);
	}
	const out = writeFrontmatterDoc(doc, body);
	if (out === raw) return false;
	writeAtomic(pp, out);
	return true;
}

/** Writes distance/ascent/descent/duration from the recorded GPX into the post's front matter (overwriting). */
export async function recomputeMetrics(root: string, slug: string, date: string): Promise<TrackMetrics> {
	const m = await computedMetrics(root, slug, date);
	if (!m) throw new ApiError(400, 'The GPX has no timestamps (a planned track): nothing to compute');
	writeMetrics(root, slug, date, m);
	return m;
}

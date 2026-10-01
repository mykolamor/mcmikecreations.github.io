/**
 * Elapsed (wall-clock) time for a hike, which needs the filesystem.
 *
 * Sources, first match wins:
 *  1. Front matter `elapsed: { start, end, source }` - hand-picked, either from
 *     photo timestamps (`source: photos`, a lower bound) or set by hand
 *     (`source: manual`). Times are local wall-clock `YYYY-MM-DDTHH:MM`.
 *  2. A recorded GPX track: first to last trackpoint `<time>`, minus any
 *     recording gap over three hours (a night at a hut).
 *
 * Planned tracks (togpx, mapy.com, openrouteservice) carry no timestamps, and
 * their GeoJSON `summary.duration` is the router's estimate, not a record, so
 * it is never used here.
 */

import { readFileSync } from 'node:fs';
import { isPlainObject } from '$lib/hikes/frontmatter';
import type { ElapsedSource, HikeElapsed } from '$lib/hikes/hike-facts';

const OVERNIGHT_GAP_MINUTES = 3 * 60;

const LOCAL_TIME =/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Minutes since epoch for a naive local wall-clock time; the zone cancels out in a difference. */
function wallClockMinutes(value: unknown): number | null {
	const text = value instanceof Date ? value.toISOString().slice(0, 19) : typeof value === 'string' ? value.trim() : '';
	const m = LOCAL_TIME.exec(text);
	if (!m) return null;
	const [, y, mo, d, h, mi, s] = m.map(Number);
	return Date.UTC(y, mo - 1, d, h, mi, s || 0) / 60000;
}

function fromFrontmatter(value: unknown): HikeElapsed | null {
	if (!isPlainObject(value)) return null;
	const start = wallClockMinutes(value.start);
	const end = wallClockMinutes(value.end);
	const source: ElapsedSource = value.source === 'manual' ? 'manual' : 'photos';
	if (start == null || end == null || end <= start) return null;
	return { minutes: end - start, source };
}

function fromGpx(file: string): HikeElapsed | null {
	let raw: string;
	try {
		raw = readFileSync(file, 'utf-8');
	} catch {
		return null;
	}
	// Skip the <metadata> block, whose <time> is the export time.
	const body = raw.slice(Math.max(0, raw.search(/<trkpt\b/)));
	const times = Array.from(body.matchAll(/<time>([^<]+)<\/time>/g), (m) => Date.parse(m[1])).filter(Number.isFinite);
	if (times.length < 2) return null;

	// A recording gap this long is a night at a hut, not hiking time.
	let minutes = 0;
	for (let i = 1; i < times.length; i++) {
		const gap = (times[i] - times[i - 1]) / 60000;
		if (gap > 0 && gap <= OVERNIGHT_GAP_MINUTES) minutes += gap;
	}
	return minutes > 0 ? { minutes, source: 'gpx' } : null;
}

/**
 * @param frontmatterElapsed The post's front-matter `elapsed` value, if any.
 * @param gpxFile Path to the post's GPX file on disk.
 */
export function readHikeElapsed(frontmatterElapsed: unknown, gpxFile: string | null): HikeElapsed | null {
	return fromFrontmatter(frontmatterElapsed) ?? (gpxFile ? fromGpx(gpxFile) : null);
}

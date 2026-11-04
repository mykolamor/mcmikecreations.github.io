import path from 'node:path';
import { ApiError } from './errors';

const HIKES = 'static/_projects/data-viz/hikes';

/** Absolute locations of everything the tool reads or writes, under the repo `root`. */
export function repoPaths(root: string) {
	const j = (...p: string[]) => path.join(root, ...p);
	return {
		static: j('static'),
		markdown: j(HIKES, 'markdown'),
		geojson: j(HIKES, 'geojson'),
		gpx: j(HIKES, 'gpx'),
		bailouts: j(HIKES, 'gpx', 'bailouts'),
		images: j('static/images/projects/data-viz/hikes'),
		thumbs: j('static/images/projects/data-viz/hikes/thumb'),
		places: j(HIKES, 'places'),
		osmStore: j(HIKES, 'osm.json'),
		factsLibrary: j(HIKES, 'facts-library.json'),
		demDir: j('static/_projects/data-viz/maps/mapbox-terrain-dem-v1'),
		hikesJson: j('src/lib/data/hikes.json'),
		strings: j('src/lib/hikes/i18n'),
		crmData: j('scripts/crm/data')
	};
}

export function assertSafeSlug(slug: string): string {
	if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_]*$/.test(slug)) {
		throw new ApiError(400, `Invalid slug: ${JSON.stringify(slug)}`);
	}
	return slug;
}

export function assertSafeDate(date: string): string {
	const m = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
	if (m) {
		const [y, mo, d] = [+m[1], +m[2], +m[3]];
		const dt = new Date(Date.UTC(y, mo - 1, d));
		if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return date;
	}
	throw new ApiError(400, `Invalid date: ${JSON.stringify(date)}`);
}

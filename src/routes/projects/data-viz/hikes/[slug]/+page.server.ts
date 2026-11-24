import { existsSync } from 'node:fs';
import { error } from '@sveltejs/kit';
import { defaultGpxPath } from '$lib/data/hikes-core';
import { hikeSlugs } from '$lib/data/hikes-db';
import { hikes } from '$lib/hikes/hikes.server';
import type { PageServerLoad } from './$types';

/**
 * Emitting every slug keeps the redirect
 * reachable for as long as the hike exists.
 */
export function entries() {
	return hikeSlugs.map((slug) => ({ slug }));
}

/**
 * Just this hike, handed to the universal load.
 *
 * The heavy lifting stays universal — it builds THREE objects, which cannot
 * cross a server boundary — but looking the hike up needs the markdown glob. A
 * `fetch('/hikes/index.json')` from the universal load would work too, except
 * SvelteKit then inlines the whole response into every prerendered page, which
 * nearly doubled each one.
 */
export const load: PageServerLoad = ({ params }) => {
	const meta = hikes.find((h) => h.route.split('/').pop() === params.slug);
	if (!meta) {
		console.log(`Failed to fetch /maps/${params.slug} metadata.`);
		error(404, { message: `Failed to fetch "${params.slug}"` });
	}

	const newest = [...meta.properties.dates].sort((a, b) => (a.date > b.date ? -1 : 1))[0];
	const gpx = newest?.gpx ?? defaultGpxPath(meta.properties.filePath);
	return { meta, gpxPath: existsSync(`static${gpx}`) ? gpx : null };
};

import { createHash } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { getPostFrontmatter, hikes } from '$lib/hikes/hikes.server';
import { readDateBailouts } from '$lib/hikes/bailouts.server';
import { postDateModified } from '$lib/server/date-modified';

export const prerender = true;

export function GET() {
	// Each date carries its own bailouts: a post's facts may override the sidecar's.
	// A date with a post also carries its `dateModified`, the same as the post page's
	// (front-matter `updated:`, else the last body change in git), so consumers can tell
	// which post changed.
	const entries = hikes.map((hike) => ({
		...hike,
		properties: {
			...hike.properties,
			dates: hike.properties.dates.map((date) => {
				const bailouts = readDateBailouts(hike, date);
				const dateModified = date.path
					? postDateModified(`static${date.path}`, date.date, getPostFrontmatter(date.path)?.updated)
					: undefined;
				return { ...date, ...(bailouts ? { bailouts } : {}), ...(dateModified ? { dateModified } : {}) };
			})
		}
	}));
	// Content hash, so consumers can tell whether the index changed since their last fetch;
	// it stays the same across deployments that don't touch hike data.
	const etag = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
	// Build time: changes on every deployment, unlike `etag`.
	return json({ etag, generated: new Date().toISOString(), hikes: entries });
}

import { headerPicture, hikes } from '$lib/hikes/hikes.server';

export const prerender = true;

/**
 * The cards list every hike that still has an unblogged date — those are the
 * ones whose map page is worth linking, since a fully blogged route redirects
 * to its post. Only the fields the page renders are passed through, so the
 * page payload does not carry the whole hike model.
 */
export function load() {
	const maps = hikes
		.filter((h) => h.properties.hidden !== true && h.properties.dates.some((d) => !d.path))
		.map((h) => ({
			name: h.name,
			image: h.image,
			srcset: headerPicture(h.image)?.srcset ?? null,
			route: h.route,
			properties: {
				draft: h.properties.draft,
				dates: h.properties.dates.map((d) => ({ date: d.date, path: d.path ?? null }))
			}
		}));

	return { maps };
}

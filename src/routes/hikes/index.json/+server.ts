import { json } from '@sveltejs/kit';
import { hikes } from '$lib/hikes/hikes.server';
import { readDateBailouts } from '$lib/hikes/bailouts.server';

export const prerender = true;

export function GET() {
	// Each date carries its own bailouts: a post's facts may override the sidecar's.
	return json(hikes.map((hike) => ({
		...hike,
		properties: {
			...hike.properties,
			dates: hike.properties.dates.map((date) => {
				const bailouts = readDateBailouts(hike, date);
				return bailouts ? { ...date, bailouts } : date;
			})
		}
	})));
}

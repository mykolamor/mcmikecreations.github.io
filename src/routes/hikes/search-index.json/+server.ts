import { json } from '@sveltejs/kit';
import { resolveHikeForDate } from '$lib/data/hikes-db';
import { headerPicture, hikes } from '$lib/hikes/hikes.server';
import type { Map } from '$lib/data/map-info';
import { hashPeople } from '$lib/hikes/name-hash';

export const prerender = true;

export interface SearchEntry {
	url: string;
	title: string;
	hikeName: string;
	nodeNames: string[];
	tags: string[];
	description: string;
	date: string;
	image?: string;
	/** The header image's AVIF tiers, `image` being the thumb fallback. */
	srcset?: string;
	peopleHashes: string[];
}

export async function GET() {
	const entries: SearchEntry[] = [];

	for (const h of hikes as Map[]) {
		const slug = h.route.substring(h.route.lastIndexOf('/') + 1);

		for (const d of h.properties.dates) {
			if (h.properties.draft || !d.path) continue;
			// A date may name its own sidecar, which carries its own POIs.
			const hike = resolveHikeForDate(h, d);
			const nodeNames = (hike.properties.nodes ?? [])
				.map((n) => n.tags?.name)
				.filter((name): name is string => !!name);

			entries.push({
				url: `/hikes/${d.date}-${slug}/`,
				title: d.title ?? hike.name,
				hikeName: hike.name,
				nodeNames,
				tags: d.tags,
				description: ((d.description ?? '') + ' ' + hike.description).trim(),
				date: d.date,
				image: (d.image ?? hike.image)?.replace('/hikes/', '/hikes/thumb/') ?? undefined,
				srcset: headerPicture(d.image ?? hike.image)?.srcset,
				peopleHashes: await hashPeople(d.people ?? [])
			});
		}
	}

	entries.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

	return json(entries);
}

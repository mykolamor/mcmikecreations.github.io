/**
 * Server-only enumeration of hike posts.
 *
 * A post's own fields are already folded into its date by `hikes.server`, so
 * this reads `date.title` / `date.tags` and friends exactly as it did when they
 * lived in `hikes.json` — but the source is now the markdown, which is why this
 * cannot ship to the client.
 */

import { headerPicture, hikes, resolveHikeForPost } from '$lib/hikes/hikes.server';
import type { ProcessedPost } from '$lib/hikes/hikes-info';

interface HikeParams {
	page?: number;
	tag?: string;
	year?: number;
	limit?: number;
}

export const defaultPageSize = 10;

export function getAllPosts(): ProcessedPost[] {
	const posts = hikes.flatMap((h) =>
		h.properties.dates
			.filter((d) => !h.properties.draft && d.path)
			.map((d) => {
				const date = new Date(d.date);
				const slug = h.route.substring(h.route.lastIndexOf('/') + 1);
				// A post may name its own sidecar, so read name/image/description
				// through the hike as that post sees it.
				const { hike } = resolveHikeForPost(h, d);
				return {
					year: date.getFullYear(),
					month: date.getMonth() + 1,
					day: date.getDate(),
					date: date,
					url: `/hikes/${d.date}-${slug}/`,
					title: d.title ?? hike.name,
					image: (d.image ?? hike.image)?.replace('/hikes/', '/hikes/thumb/'),
					srcset: headerPicture(d.image ?? hike.image)?.srcset,
					description: (d.description ? d.description + ' ' : '') + hike.description,
					tags: d.tags,
					people: d.people,
					anchor: `${d.date}-${slug}`
				};
			})
	);
	posts.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
	return posts;
}

export function getPosts({ page = 1, tag, year, limit = defaultPageSize }: HikeParams) {
	let posts = getAllPosts();

	if (tag) {
		posts = posts.filter((p) => p.tags.includes(tag));
	}

	if (year) {
		posts = posts.filter((p) => p.year === year);
	}

	const totalPosts = posts.length;
	const totalPages = Math.ceil(totalPosts / limit);
	const startIndex = (page - 1) * limit;
	const endIndex = startIndex + limit;
	const visiblePosts = posts.slice(startIndex, endIndex);

	return {
		posts: visiblePosts,
		pagination: {
			currentPage: page,
			totalPages,
			totalPosts,
			hasNext: page < totalPages,
			hasPrev: page > 1,
			nextPage: page < totalPages ? page + 1 : null,
			prevPage: page > 1 ? page - 1 : null
		}
	};
}

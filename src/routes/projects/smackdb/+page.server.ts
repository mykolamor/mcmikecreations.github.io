import { getBlogIndex } from '$lib/blog/blog-posts.server';
import { techTreeLayouts } from '$lib/tech-tree/tree.server';
import { nodeTitle } from '$lib/tech-tree/model';

export const prerender = true;

/** The laid-out tech tree timelines, and the published posts on them (for JSON-LD). */
export function load() {
	const timelines = techTreeLayouts(getBlogIndex());
	const published = new Map<string, { name: string; url: string }>();
	for (const tl of timelines) {
		for (const n of tl.nodes) {
			if (n.href && !published.has(n.anchor)) published.set(n.anchor, { name: nodeTitle(n, 'en'), url: n.href });
		}
	}
	return { timelines, published: [...published.values()] };
}

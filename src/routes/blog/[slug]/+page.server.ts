import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readingTime } from 'reading-time-estimator';
import { marked, type TokensList, type Token } from 'marked';
import { readBlogFrontmatter } from '$lib/blog/frontmatter.server';
import { getBlogPostMeta } from '$lib/blog/blog-posts.server';
import { postDateModified } from '$lib/server/date-modified';
import { BLOG_MAX_IMAGES } from '$lib/blog/blog-meta';
import { readBlogImages } from '$lib/blog/blog-images';

function cleanTokens(tokens: Token[] | TokensList | undefined) {
	if (!tokens) return;
	for (const t of tokens) {
		delete (t as any).raw;
		if ((t as any).tokens) cleanTokens((t as any).tokens);
		if ((t as any).items) cleanTokens((t as any).items);
	}
}

const IMAGE_FILE = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

/**
 * Hrefs of the body's images that are files of this site, in order, for the
 * JSON-LD `image` array. Remote images and the `/404/` placeholder are left out.
 */
function localBodyImages(tokens: TokensList): string[] {
	const out: string[] = [];
	marked.walkTokens(tokens, (t) => {
		if (t.type !== 'image') return;
		const href = (t.href ?? '').trim();
		// Only pictures: a `.js` script embed or an `.mp4` clip is no `image`.
		if (href.startsWith('/') && !href.startsWith('//') && IMAGE_FILE.test(href)) out.push(href);
	});
	return [...new Set(out)].slice(0, BLOG_MAX_IMAGES - 1);
}

export const load: PageServerLoad = async ({ fetch, params }) => {
	try {
		const slug = params.slug.endsWith('.html')
			? params.slug.substring(0, params.slug.length - '.hmtl'.length)
			: params.slug;
		const fileName = `${slug}.md`;
		const meta = getBlogPostMeta(fileName);

		if (!meta || meta.draft) {
			error(404, { message: `Failed to fetch "${slug}"` });
		}

		const url = `/_blog/${fileName}`;
		const res = await fetch(url);
		if (!res.ok) {
			console.log(`Failed to fetch ${url} with return code ${res.status}.`);
			error(404, { message: `Failed to fetch "${slug}"` });
		}

		// `postBody` has the front matter fence removed so the header outline,
		// reading time, and rendered content ignore the metadata block.
		const { data: front, content: postBody } = readBlogFrontmatter(await res.text());

		// Find all headers.
		const headerRegex = /#{2} (.*)\r?\n/g;
		const headers = Array.from(postBody.matchAll(headerRegex), x => x[1]);
		const stats = readingTime(postBody);

		const content = marked.lexer(postBody);
		const bodyImages = localBodyImages(content);
		cleanTokens(content);

		return {
			post: {
				title: meta.title,
				description: meta.description,
				image: meta.image,
				imageFull: meta.imageFull,
				// The hero's alt; without one it is decorative next to the title.
				imageAlt: typeof front.imageAlt === 'string' ? front.imageAlt.trim() : '',
				// `pnpm crm blog-images`: size, blur and AVIF tiers per image href, plus an optional `alt`.
				images: readBlogImages(front.images),
				content: content,
				headers: headers,
				time: stats.text,
				date: new Date(meta.date).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
				isoDate: meta.date,
				// Body-only git history, so a front-matter-only commit doesn't count.
				dateModified: postDateModified(`static/_blog/${fileName}`, meta.date, meta.updated),
				section: meta.section,
				wordCount: stats.words,
				minutes: stats.minutes,
				bodyImages,
				tags: meta.tags,
				author: meta.author,
				anchor: slug
			},
		};
	} catch (ex) {
		console.log(ex);
		error(500);
	}
};

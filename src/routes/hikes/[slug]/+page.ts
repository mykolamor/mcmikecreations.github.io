import { error, isHttpError } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { HttpError } from '@sveltejs/kit'
import { parseMarkdown } from '$lib/hikes/hikes-info';
import { browser } from '$app/environment';

let hasHydrated = false;

export const load: PageLoad = async ({ data, fetch, params }) => {
	try {
		const slug = params.slug.endsWith('.html')
			? params.slug.substring(0, params.slug.length - '.hmtl'.length)
			: params.slug;
		// The server load has already resolved the post; all this needs is the
		// markdown path, which the slug is: `<date>-<route slug>` names the file.
		if (!/^\d{4}-\d{2}-\d{2}-.+$/.test(slug)) {
			error(404);
		}
		const path = `/_projects/data-viz/hikes/markdown/${slug}.md`;

		let clientHtml: string | undefined = undefined;

		if (browser) {
			if (hasHydrated) {
				// Client-side navigation: fetch the raw markdown and parse it on the client
				// to avoid hitting the full index.html or bundling it in __data.json
				const res = await fetch(path);
				if (res.ok) {
					const postRaw = await res.text();
					clientHtml = (await parseMarkdown(postRaw, data.post.tags)).html;
				}
			} else {
				hasHydrated = true;
			}
		}

		return {
			post: data.post,
			map: data.map,
			display: data.display,
			contacts: data.contacts,
			clientHtml,
		};
	} catch (ex) {
		if (isHttpError(ex)) {
			throw ex;
		}

		console.log(ex);
		error(500);
	}
};

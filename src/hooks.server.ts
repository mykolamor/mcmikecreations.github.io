import type { Handle } from '@sveltejs/kit';
import { HERO_CANDIDATES_PLACEHOLDER, candidatesScriptJson } from '$lib/hikes/hero-map';
import { heroCandidates } from '$lib/hikes/hero-map.server';

export const handle: Handle = async ({ event, resolve }) => {
	return await resolve(event, {
		transformPageChunk: ({ html }) => {
			// The home page's hero map candidates, inlined once for its boot script.
			html = html.replace(HERO_CANDIDATES_PLACEHOLDER, () => candidatesScriptJson(heroCandidates));
			if (event.locals.postContent) {
				return html.replace('%%SSR_POST_CONTENT%%', '<!-- SSR_START -->' + event.locals.postContent + '<!-- SSR_END -->');
			}
			return html.replace('%%SSR_POST_CONTENT%%', '');
		}
	});
};

import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HERO_CANDIDATES_PLACEHOLDER, candidatesScriptJson } from '$lib/hikes/hero-map';
import { heroCandidates } from '$lib/hikes/hero-map.server';

const PRESENTATION_IMPORTMAP_PLACEHOLDER = '%%PRESENTATION_IMPORTMAP%%';

let importMapTag: string | undefined;

/** The import map `<script>` for presentations, read once from the vendored manifest. A missing
 *  manifest fails the build; under `vite dev` it only warns (once) and leaves the map out. */
function presentationImportMapTag(): string {
	if (importMapTag === undefined) {
		const file = path.join(process.cwd(), 'static', 'vendor', 'importmap.json');
		if (!existsSync(file)) {
			const message = `${file} is missing; run "node scripts/presentation-vendor.mjs" to vendor the presentation libraries.`;
			if (!dev) throw new Error(message);
			console.warn(`${message} Presentations won't load until then.`);
			importMapTag = '';
			return importMapTag;
		}
		const json = JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))).replace(/</g, '\\u003c');
		importMapTag = `<script type="importmap">${json}</script>`;
	}
	return importMapTag;
}

export const handle: Handle = async ({ event, resolve }) => {
	return await resolve(event, {
		transformPageChunk: ({ html }) => {
			// Must precede every module script, so it sits in <head> before %sveltekit.head%.
			html = html.replace(PRESENTATION_IMPORTMAP_PLACEHOLDER, () => presentationImportMapTag());
			// The home page's hero map candidates, inlined once for its boot script.
			html = html.replace(HERO_CANDIDATES_PLACEHOLDER, () => candidatesScriptJson(heroCandidates));
			if (event.locals.postContent) {
				return html.replace('%%SSR_POST_CONTENT%%', '<!-- SSR_START -->' + event.locals.postContent + '<!-- SSR_END -->');
			}
			return html.replace('%%SSR_POST_CONTENT%%', '');
		}
	});
};

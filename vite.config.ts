import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from "@tailwindcss/vite";

let vendored: Promise<void> | undefined;

/**
 * Vendors the presentation libraries (static/vendor/) once per process, before
 * dev serves or the prerender reads importmap.json. pnpm skips pre/post scripts
 * and deploy.sh calls `vite build` directly, so a predev/prebuild would not run.
 * (The nested d3 build uses `configFile: false`, so it never loads this plugin.)
 */
function presentationVendor(): Plugin {
	return {
		name: 'presentation-vendor',
		async buildStart() {
			vendored ??= import('./scripts/presentation-vendor.mjs').then((m) => m.vendorPresentationLibs(process.cwd()));
			await vendored;
		},
		configureServer(server) {
			// Add-ons a slide starts importing while the dev server runs.
			server.middlewares.use(async (req, _res, next) => {
				const url = req.url?.split('?')[0];
				if (url?.startsWith('/vendor/') && url.includes('/addons/')) {
					const m = await import('./scripts/presentation-vendor.mjs');
					try {
						m.copyAddonOnRequest(process.cwd(), decodeURIComponent(url));
					} catch (e) {
						server.config.logger.warn(`presentation-vendor: ${e}`);
					}
				}
				next();
			});
		}
	};
}

export default defineConfig({
	plugins: [
		presentationVendor(),
		tailwindcss(),
		sveltekit(),
	],
	server: {
		watch: {
			// `build/` is adapter-static output (thousands of map tiles). The dev
			// server never needs to watch it, and doing so exhausts the inotify
			// watcher limit on Linux (ENOSPC).
			// Same for the scripts' Python venv, which the site never loads.
			ignored: ['**/build/**', '**/scripts/.venv/**'],
		},
	},
});

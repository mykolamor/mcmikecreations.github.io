import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
	],
	server: {
		watch: {
			// `build/` is adapter-static output (thousands of map tiles). The dev
			// server never needs to watch it, and doing so exhausts the inotify
			// watcher limit on Linux (ENOSPC).
			// Same for the image matcher's Python venv and its ~23k-file cache,
			// neither of which the site ever loads.
			ignored: ['**/build/**', '**/scripts/.venv/**', '**/scripts/matches/hikes/.image-match-cache/**'],
		},
	},
});

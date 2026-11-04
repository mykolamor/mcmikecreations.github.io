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
			// Same for the scripts' Python venv, which the site never loads.
			ignored: ['**/build/**', '**/scripts/.venv/**'],
		},
	},
});

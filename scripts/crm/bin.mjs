#!/usr/bin/env node
// `pnpm crm [--port N]` starts the UI (Vite, as before); `pnpm crm <command> [args]` runs a headless command
// from cli/index.ts, loaded through Vite so the server code resolves exactly as in the UI.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, 'vite.config.ts');
const args = process.argv.slice(2);

if (args.length === 0 || args[0].startsWith('-')) {
	// the vite binary, in this process, as if run as `vite --config scripts/crm/vite.config.ts <args>`
	const viteBin = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
	process.argv = [process.argv[0], viteBin, '--config', configFile, ...args];
	await import(pathToFileURL(viteBin).href);
} else {
	const { createServer } = await import('vite');
	let code = 1;
	let server;
	try {
		server = await createServer({
			configFile,
			server: { middlewareMode: true, hmr: false, watch: null },
			appType: 'custom',
			logLevel: 'warn',
			// browser dependency pre-bundling isn't needed here; its own cache keeps it off the UI's (which may be running)
			optimizeDeps: { noDiscovery: true, include: [] },
			cacheDir: path.join(here, '../../node_modules/.vite-crm-cli')
		});
		const { run } = await server.ssrLoadModule('/cli/index.ts');
		code = await run(args);
	} catch (e) {
		console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
	} finally {
		await server?.close();
	}
	process.exit(code);
}

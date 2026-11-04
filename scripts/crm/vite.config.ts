import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import pty from '@lydell/node-pty';
import { WebSocketServer } from 'ws';
import { ClaudeTerminal, sameOriginLoopback, type ServerMsg } from './server/claude-terminal';
import { loadSettings } from './server/settings';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/** Mounts /api/* on the dev server; server code is loaded through Vite so edits hot-reload. */
function crmApi(): Plugin {
	return {
		name: 'crm-api',
		configureServer(server) {
			// Node cuts a request after 5 minutes by default; a 2 GB video upload over SSH can take longer.
			const http = server.httpServer as import('node:http').Server | null;
			if (http) http.requestTimeout = 0;
			server.middlewares.use('/api', async (req, res) => {
				// connect strips the mount prefix; restore it for the router
				req.url = '/api' + (req.url ?? '/');
				try {
					const [{ createApi }, { handleHttp }] = await Promise.all([
						server.ssrLoadModule(path.join(here, 'server/api.ts')),
						server.ssrLoadModule(path.join(here, 'server/http.ts'))
					]);
					await handleHttp(createApi(repoRoot), req, res);
				} catch (e) {
					if (!res.headersSent) {
						res.statusCode = 500;
						res.setHeader('content-type', 'application/json');
					}
					res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
				}
			});
		}
	};
}

/**
 * The Claude tab: one Claude Code process in the repo root, owned by this server (see server/claude-terminal.ts), on a
 * WebSocket at /crm-claude/socket. Only the CRM's own page gets in: loopback Host, same-host Origin and the token from
 * /crm-claude/token, made at each start. Not reloaded with the API code: editing it restarts the server, and the session.
 */
function claudeTerminal(): Plugin {
	return {
		name: 'crm-claude',
		configureServer(server) {
			const http = server.httpServer as import('node:http').Server | null;
			if (!http) return; // headless commands (bin.mjs) run in middleware mode
			const token = randomBytes(24).toString('base64url');
			const term = new ClaudeTerminal({
				root: repoRoot,
				spawn: (file, args, opts) => pty.spawn(file, args, { name: 'xterm-256color', ...opts }),
				command: () => loadSettings(repoRoot).claudeCommand ?? 'claude'
			});
			const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
			server.middlewares.use('/crm-claude/token', (req, res) => {
				const site = req.headers['sec-fetch-site'];
				res.setHeader('content-type', 'application/json');
				res.setHeader('cache-control', 'no-store');
				if (!sameOriginLoopback({ host: req.headers.host, origin: req.headers.origin }, false) || (site !== undefined && site !== 'same-origin')) {
					res.statusCode = 403;
					res.end(JSON.stringify({ error: 'forbidden' }));
					return;
				}
				res.end(JSON.stringify({ token }));
			});
			http.on('upgrade', (req, socket, head) => {
				const url = new URL(req.url ?? '/', 'http://127.0.0.1');
				if (url.pathname !== '/crm-claude/socket') return; // Vite's own (HMR) sockets
				const given = Buffer.from(url.searchParams.get('token') ?? '');
				const want = Buffer.from(token);
				const ok = sameOriginLoopback({ host: req.headers.host, origin: req.headers.origin }, true) && given.length === want.length && timingSafeEqual(given, want);
				if (!ok) {
					socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
					return;
				}
				const num = (k: string) => {
					const v = url.searchParams.get(k);
					return v ? Number(v) : undefined;
				};
				wss.handleUpgrade(req, socket, head, (ws) => {
					const client = {
						send: (m: ServerMsg) => {
							if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
						}
					};
					term.attach(client, num('cols'), num('rows'));
					ws.on('message', (d) => term.handle(String(d)));
					ws.on('close', () => term.detach(client));
				});
			});
			http.on('close', () => {
				term.dispose();
				wss.close();
			});
		}
	};
}

export default defineConfig({
	root: here,
	// the repo's static/ is served read-only so the Files card can preview covers and thumbnails
	publicDir: path.join(repoRoot, 'static'),
	plugins: [svelte(), crmApi(), claudeTerminal()],
	resolve: { alias: { $lib: path.join(repoRoot, 'src/lib') } },
	server: { host: '127.0.0.1', port: 8765, strictPort: true, fs: { allow: [repoRoot] } }
});

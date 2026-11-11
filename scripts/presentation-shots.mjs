#!/usr/bin/env node
// Screenshots every state of a deck (and optionally page elements) for visual regression checks.
// Needs a running dev server (`pnpm dev`) and google-chrome. Drives headless Chrome over CDP with
// Node's built-in WebSocket and the deck's external API (`[data-presentation="<deck>"]`.presentation).
//
//   node scripts/presentation-shots.mjs --url http://localhost:5173/blog/<slug> --deck <name> --out <dir>
//        [--lang en|de|uk] [--theme light|dark] [--selector '<css>']
//
// Writes <out>/<slide>-<state>.png (two digits each), <out>/embed-<n>.png per --selector match and
// <out>/console.txt. Exits 1 if the page logged a console error or threw.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({
	options: {
		url: { type: 'string' },
		deck: { type: 'string' },
		out: { type: 'string' },
		lang: { type: 'string' },
		theme: { type: 'string', default: 'light' },
		selector: { type: 'string' },
		port: { type: 'string', default: '9333' }
	}
});
if (!o.url || !o.deck || !o.out) {
	console.error('usage: presentation-shots.mjs --url <page> --deck <name> --out <dir> [--lang l] [--theme light|dark] [--selector css]');
	process.exit(2);
}
mkdirSync(o.out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'pres-shots-'));
const chrome = spawn('google-chrome', [
	'--headless=new', `--remote-debugging-port=${o.port}`, '--window-size=1600,1000', `--user-data-dir=${profile}`,
	'--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'
], { stdio: 'ignore' });

/** First page target's WebSocket URL, retried while Chrome starts. */
async function pageSocket() {
	for (let i = 0; i < 50; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${o.port}/json/list`)).json();
			const page = list.find((t) => t.type === 'page');
			if (page) return page.webSocketDebuggerUrl;
		} catch { /* not up yet */ }
		await sleep(200);
	}
	throw new Error('Chrome did not expose a page target');
}

/** Minimal CDP client: send(method, params) → result; on(method, fn). */
function cdp(ws) {
	let id = 0;
	const pending = new Map();
	const handlers = new Map();
	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(String(ev.data));
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(`${msg.error.message}`));
			else resolve(msg.result);
		} else if (msg.method) handlers.get(msg.method)?.(msg.params);
	});
	return {
		send: (method, params = {}) => new Promise((resolve, reject) => {
			const n = ++id;
			pending.set(n, { resolve, reject });
			ws.send(JSON.stringify({ id: n, method, params }));
		}),
		on: (method, fn) => handlers.set(method, fn)
	};
}

const errors = [];
let exitCode = 0;
try {
	const ws = new WebSocket(await pageSocket());
	await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
	const c = cdp(ws);
	c.on('Runtime.consoleAPICalled', (p) => {
		if (p.type === 'error') errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
	});
	c.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
	await c.send('Runtime.enable');
	await c.send('Page.enable');
	await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

	/** Evaluates `expr` in the page and returns its value. */
	const evaluate = async (expr) => {
		const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
		return r.result.value;
	};
	/** Screenshot of the element's box (scrolled into view first). */
	const shoot = async (selectorExpr, file) => {
		const box = await evaluate(`(() => { const el = ${selectorExpr}; el.scrollIntoView({ block: 'center' });
			const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
		await sleep(150);
		const { data } = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, captureBeyondViewport: true });
		writeFileSync(join(o.out, file), Buffer.from(data, 'base64'));
	};

	await c.send('Page.navigate', { url: o.url });
	const deck = `document.querySelector('[data-presentation="${o.deck}"]')`;
	for (let i = 0; i < 100 && !(await evaluate(`!!(${deck}?.presentation)`)); i++) await sleep(200);
	if (!(await evaluate(`!!(${deck}?.presentation)`))) throw new Error(`deck "${o.deck}" not found on ${o.url}`);
	if (o.theme === 'dark') await evaluate(`document.documentElement.classList.add('dark')`);
	else await evaluate(`document.documentElement.classList.remove('dark')`);
	if (o.lang) await evaluate(`${deck}.presentation.setLanguage(${JSON.stringify(o.lang)})`);
	await sleep(500);

	const pad = (n) => String(n + 1).padStart(2, '0');
	let shots = 0;
	for (let s = 0; ; s++) {
		if (!(await evaluate(`${deck}.presentation.goTo({ slide: ${s}, state: 0 })`))) break;
		for (let t = 0; ; t++) {
			if (!(await evaluate(`${deck}.presentation.goTo({ slide: ${s}, state: ${t} })`))) break;
			await shoot(deck, `${pad(s)}-${pad(t)}.png`);
			shots++;
		}
	}
	if (o.selector) {
		const n = await evaluate(`document.querySelectorAll(${JSON.stringify(o.selector)}).length`);
		for (let k = 0; k < n; k++) await shoot(`document.querySelectorAll(${JSON.stringify(o.selector)})[${k}]`, `embed-${k + 1}.png`);
		console.log(`${n} element(s) for ${o.selector}`);
	}
	console.log(`${shots} deck state(s) → ${o.out}`);
	ws.close();
} catch (e) {
	errors.push(`script: ${e.message}`);
} finally {
	chrome.kill();
	await sleep(300);
	rmSync(profile, { recursive: true, force: true });
	writeFileSync(join(o.out, 'console.txt'), errors.join('\n') + (errors.length ? '\n' : ''));
	if (errors.length) {
		console.error(errors.join('\n'));
		exitCode = 1;
	}
}
process.exit(exitCode);

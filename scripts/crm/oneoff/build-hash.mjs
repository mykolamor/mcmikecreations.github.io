#!/usr/bin/env node
/**
 * Builds the site into a temp dir and prints a hash of every file under
 * `build/hikes/` and `build/projects/`, one `path<TAB>sha256` line each,
 * sorted. Two runs on trees that should render the same must print the same
 * lines: the byte-identical gate for refactors.
 *
 *   node scripts/crm/oneoff/build-hash.mjs [tree] > after.txt
 *   cmp before.txt after.txt
 *
 * `tree` is the checkout to build (default: this repo, with its uncommitted
 * changes); pass a worktree of the base commit for `before.txt`. The tree is
 * copied into the temp dir (`static/` hard-linked, `node_modules` linked per
 * entry), so the build never touches the tree's `build/` or `.svelte-kit/`.
 * Git still reads the tree's repo, for the posts' `dateModified`.
 * Keep the outputs outside the repo.
 *
 * Normalised before hashing, since they change with any code change:
 * - hashed asset names: `_app/immutable/nodes/3.BxYz12aB.js` → `_app/immutable/nodes/3.[hash].js`,
 *   `_app/immutable/chunks/BaCBFVS_.js` → `_app/immutable/chunks/[hash].js`;
 * - the build version in `__sveltekit_<version>`;
 * - a feed's own build time (`<lastBuildDate>`, `<pubDate>`, `<updated>` before its first item).
 *
 * The build's own output goes to stderr. Set BUILD_HASH_KEEP=1 to keep the temp dir.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Top-level entries the site build doesn't read, or that a build writes. */
const SKIP = new Set([
	'.git', 'node_modules', 'build', '.svelte-kit', '.idea', '.claude', '.superpowers',
	'.pytest_cache', 'docs', 'scripts', 'deploy.sh', '.deploy-assets.hash'
]);
const HASHED_DIRS = ['hikes', 'projects'];
const TEXT_EXT = new Set(['.html', '.json', '.xml', '.js', '.css', '.txt', '.php', '.svg', '.webmanifest']);

const tree = path.resolve(process.argv[2] ?? REPO);
if (!fs.existsSync(path.join(tree, 'svelte.config.js'))) {
	console.error(`build-hash: ${tree} is no site checkout (no svelte.config.js)`);
	process.exit(2);
}
const modules = fs.existsSync(path.join(tree, 'node_modules')) ? path.join(tree, 'node_modules') : path.join(REPO, 'node_modules');

/** Copies `from` to `to`; with `link`, hard-links files instead (falls back to copying across devices). */
function copyTree(from, to, link) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dst = path.join(to, entry.name);
		if (entry.isDirectory()) copyTree(src, dst, link);
		else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
		else if (link) {
			try {
				fs.linkSync(src, dst);
			} catch {
				fs.copyFileSync(src, dst);
			}
		} else fs.copyFileSync(src, dst);
	}
}

/** The build version, hashed asset names and a feed's build time, replaced by placeholders. */
function normalise(text, ext) {
	if (ext === '.xml') {
		// A feed's own dates (before its first item) are the build time; the items' are the posts'.
		const at = text.search(/<(item|entry)\b/);
		const head = at === -1 ? text : text.slice(0, at);
		text = head.replace(/<(lastBuildDate|pubDate|updated)>[^<]*</g, '<$1>[build-time]<') + text.slice(head.length);
	}
	return text
		.replace(/(_app\/immutable\/[\w./-]*?)([\w-]+\.)?[\w-]{6,}(\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|avif|json|wasm))\b/g,
			(_, dir, name = '', ext) => `${dir}${name}[hash]${ext}`)
		.replace(/__sveltekit_[a-z0-9]+/g, '__sveltekit_[version]');
}

function* walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else yield p;
	}
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-hash-'));
let status = 0;
try {
	for (const entry of fs.readdirSync(tree, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const src = path.join(tree, entry.name);
		if (entry.isDirectory()) copyTree(src, path.join(tmp, entry.name), entry.name === 'static');
		else if (entry.isFile()) fs.copyFileSync(src, path.join(tmp, entry.name));
	}
	// Per-entry links, so vite's caches land in the temp dir, not in the real node_modules.
	fs.mkdirSync(path.join(tmp, 'node_modules'));
	for (const name of fs.readdirSync(modules)) {
		if (name === '.vite') continue;
		fs.symlinkSync(path.join(modules, name), path.join(tmp, 'node_modules', name));
	}

	// The build reads git history (a post's `dateModified`): point git at the tree's repo.
	const gitDir = spawnSync('git', ['-C', tree, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).stdout.trim();
	const build = spawnSync(path.join(tmp, 'node_modules/.bin/vite'), ['build'], {
		cwd: tmp,
		env: { ...process.env, ...(gitDir ? { GIT_DIR: gitDir, GIT_WORK_TREE: tmp } : {}) },
		stdio: ['ignore', process.stderr, process.stderr]
	});
	if (build.status !== 0) {
		console.error(`build-hash: vite build failed (${build.status ?? build.signal})`);
		status = 1;
	} else {
		const out = path.join(tmp, 'build');
		const lines = [];
		for (const dir of HASHED_DIRS) {
			const root = path.join(out, dir);
			if (!fs.existsSync(root)) continue;
			for (const file of walk(root)) {
				const rel = path.relative(out, file).split(path.sep).join('/');
				let data = fs.readFileSync(file);
				const ext = path.extname(file);
				if (TEXT_EXT.has(ext)) data = Buffer.from(normalise(data.toString('utf8'), ext), 'utf8');
				lines.push(`${rel}\t${createHash('sha256').update(data).digest('hex')}`);
			}
		}
		lines.sort();
		if (lines.length === 0) {
			console.error('build-hash: no files under build/hikes or build/projects');
			status = 1;
		} else process.stdout.write(lines.join('\n') + '\n');
	}
} finally {
	if (process.env.BUILD_HASH_KEEP) console.error(`build-hash: kept ${tmp}`);
	else fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);

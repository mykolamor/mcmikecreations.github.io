#!/usr/bin/env node
/**
 * Compares two site builds whose page data may store the hike facts in an
 * older and a newer form: the gate for a facts-data migration, where
 * build-hash's exact bytes can't match because `authoredFacts` ships with
 * the page (`__data.json` and the page's inline hydration script).
 *
 *   BUILD_HASH_KEEP=1 node scripts/crm/oneoff/build-hash.mjs <base-worktree> > before.txt   # prints "kept <dir>"
 *   BUILD_HASH_KEEP=1 node scripts/crm/oneoff/build-hash.mjs > after.txt
 *   node scripts/crm/oneoff/facts-data-compare.mjs <kept-before-dir> <kept-after-dir>
 *
 * Each argument is a kept build-hash temp dir or a `build/` dir. Every file
 * under `hikes/` and `projects/` is compared:
 * - `.html`: with the inline hydration script removed (its data is the page
 *   data, compared below), hashed asset names and the build version normalised
 *   as in build-hash;
 * - `__data.json`: decoded (devalue), each node's `authoredFacts` normalised
 *   through the route-list rules, then compared with sorted keys;
 * - anything else: as build-hash normalises it.
 *
 * Route-list normalisation: `legs` and the old `difficulty.sections` become
 * the two views the page renders, the leg table (entries with `inTable`,
 * default true, each `from` the previous one's `to`) and the profile (entries
 * with `onProfile`; an old section is one), flags dropped. So an old and a
 * new form that render the same compare equal. A profile entry keeps its own
 * span: the page data already carries a table entry's chained `from`, so an
 * entry on both is checked with the `from` the page draws its band from.
 *
 * Prints one line per differing file and a summary; exits 1 on any difference.
 * Remove the kept dirs afterwards.
 *
 *   node scripts/crm/oneoff/facts-data-compare.mjs --self-test <build>
 *
 * The negative check: in the first page whose route list has a table entry
 * with a `from`, puts that entry on the profile too, then gives the copy a
 * wrong `from`. The two must compare different (and equal without the wrong
 * `from`); exits 1 otherwise.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// devalue is SvelteKit's own dependency, not the site's.
const kitRequire = createRequire(createRequire(path.join(REPO, 'package.json')).resolve('@sveltejs/kit/package.json'));
const { unflatten } = await import(kitRequire.resolve('devalue'));

const DIRS = ['hikes', 'projects'];

function buildDir(arg) {
	const dir = path.resolve(arg);
	return fs.existsSync(path.join(dir, 'build', 'hikes')) ? path.join(dir, 'build') : dir;
}

function* walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else yield p;
	}
}

function files(root) {
	const out = new Map();
	for (const dir of DIRS) {
		if (!fs.existsSync(path.join(root, dir))) continue;
		for (const file of walk(path.join(root, dir))) out.set(path.relative(root, file).split(path.sep).join('/'), file);
	}
	return out;
}

/** As build-hash: hashed asset names, the build version, a feed's own build time. */
function normalise(text, ext) {
	if (ext === '.xml') {
		const at = text.search(/<(item|entry)\b/);
		const head = at === -1 ? text : text.slice(0, at);
		text = head.replace(/<(lastBuildDate|pubDate|updated)>[^<]*</g, '<$1>[build-time]<') + text.slice(head.length);
	}
	return text
		.replace(/(_app\/immutable\/[\w./-]*?)([\w-]+\.)?[\w-]{6,}(\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|avif|json|wasm))\b/g,
			(_, dir, name = '', ext) => `${dir}${name}[hash]${ext}`)
		.replace(/__sveltekit_[a-z0-9]+/g, '__sveltekit_[version]');
}

/** SvelteKit's inline start-up script, which carries the page data. */
function stripHydration(html) {
	return html.replace(/<script>\s*\{\s*__sveltekit_[\s\S]*?<\/script>/g, '<script>[hydration]</script>');
}

/** The leg table and the profile, as the page renders them from `legs` and the old `difficulty.sections`. */
function routeView(facts) {
	if (!facts || typeof facts !== 'object') return facts;
	const f = structuredClone(facts);
	const entries = [
		...(f.legs ?? []).map((l) => ({ inTable: true, onProfile: false, ...l })),
		...(f.difficulty?.sections ?? []).map((s) => ({ ...s, inTable: false, onProfile: true }))
	];
	delete f.legs;
	if (f.difficulty) {
		delete f.difficulty.sections;
		if (!Object.keys(f.difficulty).length) delete f.difficulty;
	}
	if (!entries.length) return f;
	const table = [];
	const profile = [];
	let prev;
	for (const { inTable, onProfile, ...entry } of entries) {
		if (inTable) {
			const { from, ...row } = entry;
			table.push(prev ? { from: prev, ...row } : row);
			prev = entry.to;
		}
		if (onProfile) profile.push(entry);
	}
	f.legs = { table, profile };
	return f;
}

/** JSON with sorted keys, so key order doesn't count. */
function canonical(v) {
	return JSON.stringify(v, (_, x) =>
		x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x
	);
}

/** A `__data.json` with each data node decoded. */
function decode(text) {
	const json = JSON.parse(text);
	const nodes = (json.nodes ?? []).map((node) =>
		node?.type === 'data' && Array.isArray(node.data) ? { ...node, data: unflatten(node.data) } : node
	);
	return { ...json, nodes };
}

/** Decoded page data in comparable form: the facts as their route views, keys sorted. */
function canonicalData(decoded) {
	const nodes = decoded.nodes.map((node) => {
		const data = node?.data;
		if (!data || typeof data !== 'object' || !('authoredFacts' in data)) return node;
		return { ...node, data: { ...data, authoredFacts: routeView(data.authoredFacts) } };
	});
	return canonical({ ...decoded, nodes });
}

function pageData(text) {
	return canonicalData(decode(text));
}

/** See the header: a wrong `from` on an entry in the table and on the profile must not compare equal. */
function selfTest(root) {
	for (const [rel, file] of files(root)) {
		if (path.basename(file) !== '__data.json') continue;
		const page = decode(fs.readFileSync(file, 'utf8'));
		const node = page.nodes.findIndex((n) => (n?.data?.authoredFacts?.legs ?? []).some((l) => l.inTable && l.from));
		if (node < 0) continue;
		const legs = page.nodes[node].data.authoredFacts.legs;
		const at = legs.findIndex((l) => l.inTable && l.from);
		const variant = (from) => {
			const copy = structuredClone(page);
			const leg = copy.nodes[node].data.authoredFacts.legs[at];
			leg.onProfile = true;
			if (from) leg.from = from;
			return canonicalData(copy);
		};
		const wrong = { ...legs[at].from, name: { en: 'Somewhere else' }, lat: (legs[at].from.lat ?? 0) + 0.01 };
		const same = variant() === variant();
		const caught = variant() !== variant(wrong);
		console.log(`facts-data-compare self-test: ${rel} legs[${at}] on table and profile; unchanged ${same ? 'equal' : 'DIFFERS'}, wrong from ${caught ? 'differs' : 'EQUAL'}`);
		return same && caught;
	}
	console.log('facts-data-compare self-test: no page has a table entry with a from');
	return false;
}

function comparable(file) {
	const ext = path.extname(file);
	const raw = fs.readFileSync(file);
	if (path.basename(file) === '__data.json') return pageData(raw.toString('utf8'));
	if (ext === '.html') return normalise(stripHydration(raw.toString('utf8')), ext);
	if (['.json', '.xml', '.js', '.css', '.txt', '.php', '.svg', '.webmanifest'].includes(ext)) return normalise(raw.toString('utf8'), ext);
	return createHash('sha256').update(raw).digest('hex');
}

if (process.argv[2] === '--self-test') {
	if (!process.argv[3]) {
		console.error('usage: facts-data-compare.mjs --self-test <build>');
		process.exit(2);
	}
	process.exit(selfTest(buildDir(process.argv[3])) ? 0 : 1);
}

const [beforeArg, afterArg] = process.argv.slice(2);
if (!beforeArg || !afterArg) {
	console.error('usage: facts-data-compare.mjs <before-build> <after-build>');
	process.exit(2);
}
const before = files(buildDir(beforeArg));
const after = files(buildDir(afterArg));
const counts = { html: 0, data: 0, other: 0 };
let differ = 0;
for (const rel of [...new Set([...before.keys(), ...after.keys()])].sort()) {
	const b = before.get(rel);
	const a = after.get(rel);
	if (!b || !a) {
		console.log(`${rel}\t${b ? 'only before' : 'only after'}`);
		differ++;
		continue;
	}
	const kind = rel.endsWith('/__data.json') ? 'data' : rel.endsWith('.html') ? 'html' : 'other';
	counts[kind]++;
	if (comparable(b) !== comparable(a)) {
		console.log(`${rel}\tdiffers (${kind})`);
		differ++;
	}
}
console.log(`facts-data-compare: ${counts.html} html, ${counts.data} page data, ${counts.other} other files compared; ${differ ? `${differ} differ` : 'all equal'}`);
process.exit(differ ? 1 : 0);

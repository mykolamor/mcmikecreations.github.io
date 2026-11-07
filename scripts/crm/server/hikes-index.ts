import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { POST_FILE, englishText } from '$lib/data/hikes-core.js';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { hasPins } from './photo-badges';
import { repoPaths } from './paths';
import { listPlaces } from './place-doc';
import { fileGaps, readLibrary, sidecarGaps } from './translation-gaps';
import { isTranslationFile } from './translations';
import type { Gaps } from '../shared/translation-gaps';

export type HikeRow = {
	slug: string;
	name: string;
	hasGeojson: boolean;
	hasGpx: boolean;
	/** The sidecar has a non-empty `facts` sheet. */
	hasFacts: boolean;
	/** What the sidecar lacks per language: its facts, its name and description. */
	gaps: Gaps;
	/**
	 * `hasFacts`: the post's front matter has a non-empty `facts` sheet. `hasPins`: a photo of the post has a pin.
	 * `gaps`: what the post itself lacks per language.
	 */
	posts: { date: string; path: string; title: string; hasFacts: boolean; hasPins: boolean; gaps: Gaps }[];
	postlessDates: string[];
};

const ROUTE_PREFIX = '/projects/data-viz/hikes/';

export type HikesJsonEntry = { route: string; properties: Record<string, any> & { dates?: Record<string, any>[] } };

export function readHikesJson(root: string): HikesJsonEntry[] {
	const p = repoPaths(root).hikesJson;
	return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

/** A `facts` value that says something: a non-empty object (an empty `facts: {}` or `null` is no sheet). */
function isFactsSheet(v: unknown): boolean {
	return typeof v === 'object' && v !== null && Object.keys(v).length > 0;
}

function postHead(file: string): { title: string | null; hasFacts: boolean; hasPins: boolean } {
	try {
		const front = readFrontmatterDoc(readFileSync(file, 'utf8')).doc.toJS() ?? {};
		return { title: typeof front.title === 'string' ? front.title : null, hasFacts: isFactsSheet(front.facts), hasPins: hasPins(front) };
	} catch {
		return { title: null, hasFacts: false, hasPins: false };
	}
}

/** Hikes with their posts, and the place docs (`places`, not counted in `postCount`). */
export function listHikes(root: string): { postCount: number; hikes: HikeRow[]; places: { slug: string; title: string; gaps: Gaps }[] } {
	const p = repoPaths(root);
	const files = existsSync(p.markdown) ? readdirSync(p.markdown) : [];
	const rows = new Map<string, HikeRow>();
	const library = readLibrary(root);
	for (const f of files) {
		const m = /^(.+)\.hike\.json$/.exec(f);
		if (!m) continue;
		let name = m[1];
		let hasFacts = false;
		let gaps: Gaps = {};
		try {
			const j = JSON.parse(readFileSync(path.join(p.markdown, f), 'utf8'));
			const en = englishText(j.name);
			if (typeof en === 'string' && en) name = en;
			hasFacts = isFactsSheet(j.facts);
			gaps = sidecarGaps(j, library);
		} catch {
			/* unreadable sidecar: keep the slug as name */
		}
		rows.set(m[1], {
			slug: m[1],
			name,
			hasGeojson: existsSync(path.join(p.geojson, `${m[1]}.json`)),
			hasGpx: existsSync(path.join(p.gpx, `${m[1]}.gpx`)),
			hasFacts,
			gaps,
			posts: [],
			postlessDates: []
		});
	}
	let postCount = 0;
	for (const f of files.sort()) {
		const m = POST_FILE.exec(f);
		if (!m || isTranslationFile(f)) continue;
		postCount++;
		const row = rows.get(m[2]);
		const full = path.join(p.markdown, f);
		if (!row) continue;
		const head = postHead(full);
		row.posts.push({ date: m[1], path: full, title: head.title ?? row.name, hasFacts: head.hasFacts, hasPins: head.hasPins, gaps: fileGaps(full, library) });
	}
	for (const e of readHikesJson(root)) {
		if (!e.route.startsWith(ROUTE_PREFIX)) continue;
		const row = rows.get(e.route.slice(ROUTE_PREFIX.length));
		if (row) row.postlessDates = (e.properties.dates ?? []).map((d) => d.date).sort().reverse();
	}
	for (const r of rows.values()) r.posts.sort((a, b) => b.date.localeCompare(a.date));
	return { postCount, hikes: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)), places: listPlaces(root).map((pl) => ({ ...pl, gaps: fileGaps(path.join(p.places, `${pl.slug}.md`), library) })) };
}

export type SuggestKind = 'tags' | 'people' | 'places';

/** Existing values for a chips field, most used first, then by name. */
export function suggestions(root: string, kind: SuggestKind): string[] {
	const p = repoPaths(root);
	const counts = new Map<string, number>();
	const bump = (v: unknown, by = 1) => {
		const s = typeof v === 'string' ? v.trim() : '';
		if (s) counts.set(s, (counts.get(s) ?? 0) + by);
	};
	if (kind === 'places') {
		if (existsSync(p.places)) for (const f of readdirSync(p.places)) if (f.endsWith('.md') && !isTranslationFile(f)) bump(f.slice(0, -3), 0);
	} else {
		const contacts = path.join(root, 'src/lib/data/contacts.json');
		if (kind === 'people' && existsSync(contacts)) {
			try {
				for (const name of Object.keys(JSON.parse(readFileSync(contacts, 'utf8')))) bump(name, 0);
			} catch {
				/* unreadable contacts: no suggestions from them */
			}
		}
	}
	for (const f of existsSync(p.markdown) ? readdirSync(p.markdown) : []) {
		if (!POST_FILE.test(f) || isTranslationFile(f)) continue;
		try {
			const { doc } = readFrontmatterDoc(readFileSync(path.join(p.markdown, f), 'utf8'));
			const v = doc.toJS()[kind];
			if (Array.isArray(v)) for (const x of v) bump(x);
		} catch {
			/* unreadable post: contributes nothing */
		}
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

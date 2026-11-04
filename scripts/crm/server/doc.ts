import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { ApiError } from './errors';
import { assertSafeDate, assertSafeSlug, repoPaths } from './paths';
import { FIELDS, isMapField, type FieldDecl } from '../shared/fields';
import { applyOps, type FieldOp } from '../shared/ops';
import type { FilesState } from './files';
import { mirrorRows, type MirrorRow } from '../shared/mirrors';
import { englishText } from '$lib/data/hikes-core.js';
import type { Lang } from '$lib/i18n/languages';

export type HikeDoc = {
	slug: string;
	date: string | null;
	sidecarRaw: string;
	postRaw: string | null;
	version: string;
};

/** A file's version: the sha1 of its text (or bytes). */
export const versionOf = (text: string | Buffer): string => createHash('sha1').update(text).digest('hex');

export function docVersion(sidecarRaw: string, postRaw: string | null): string {
	return versionOf(sidecarRaw + '\0' + (postRaw ?? ''));
}

export function sidecarPath(root: string, slug: string): string {
	return path.join(repoPaths(root).markdown, `${slug}.hike.json`);
}

export function postPath(root: string, slug: string, date: string): string {
	return path.join(repoPaths(root).markdown, `${date}-${slug}.md`);
}

/** `date` null means sidecar only (no post). */
export function loadDoc(root: string, slug: string, date: string | null): HikeDoc {
	assertSafeSlug(slug);
	if (date !== null) assertSafeDate(date);
	const sp = sidecarPath(root, slug);
	if (!existsSync(sp)) throw new ApiError(404, `No sidecar for ${slug}`);
	const sidecarRaw = readFileSync(sp, 'utf8');
	let postRaw: string | null = null;
	if (date !== null) {
		const pp = postPath(root, slug, date);
		if (!existsSync(pp)) throw new ApiError(404, `No post ${date}-${slug}`);
		postRaw = readFileSync(pp, 'utf8');
	}
	return { slug, date, sidecarRaw, postRaw, version: docVersion(sidecarRaw, postRaw) };
}

/** YAML dates as `YYYY-MM-DD`; anything else as is. */
export function plain(v: unknown): unknown {
	return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

/** Current value of a declared field, or undefined when absent. */
export function readField(doc: HikeDoc, decl: FieldDecl, scope: 'hike' | 'post' = 'hike'): unknown {
	if (decl.file === 'sidecar' && scope === 'hike') {
		const errors: ParseError[] = [];
		let v: any = parse(doc.sidecarRaw, errors);
		if (errors.length) throw new ApiError(500, 'sidecar is not valid JSON');
		for (const k of decl.path) v = v?.[k];
		return v;
	}
	if (doc.postRaw === null) return undefined;
	const { doc: fm } = readFrontmatterDoc(doc.postRaw);
	const v = fm.getIn(decl.path);
	if (v === undefined) return undefined;
	const js = (fm.getIn(decl.path, true) as any)?.toJS?.(fm) ?? v;
	return Array.isArray(js) ? js.map(plain) : plain(js);
}

export type { MirrorRow };

/** What the browser sees; `files` is defined by the files task, `mirrors` by the mirrors task. */
export type ClientDoc = {
	/** `hike`: sidecar only (no post), `date` null. */
	kind: 'post' | 'hike';
	slug: string;
	date: string | null;
	version: string;
	fields: Record<string, unknown>;
	/** Every language of each translated field (`fields` has the English only). */
	texts: Record<string, Partial<Record<Lang, string>>>;
	mirrors: MirrorRow[];
	/** Filled by the GET /api/doc handler (async: reads image sizes); null elsewhere. */
	files: FilesState | null;
	/** The post's markdown after the front matter, byte for byte; null for a hike. */
	body: string | null;
	/** The authored `facts` of each file as they are (YAML dates as `YYYY-MM-DD`); null where there are none or no post. */
	facts: { hike: unknown | null; post: unknown | null };
};

function postSources(postRaw: string): unknown {
	const { doc: fm } = readFrontmatterDoc(postRaw);
	return (fm.getIn(['facts', 'sources'], true) as any)?.toJS?.(fm);
}

/** `plain` all the way down. */
function plainDeep(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(plainDeep);
	if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainDeep(x)]));
	return plain(v);
}

function factsOf(doc: HikeDoc): ClientDoc['facts'] {
	const hike = (parse(doc.sidecarRaw) as { facts?: unknown } | undefined)?.facts ?? null;
	if (doc.postRaw === null) return { hike, post: null };
	const { doc: fm } = readFrontmatterDoc(doc.postRaw);
	const node = fm.getIn(['facts'], true) as { toJS?: (d: typeof fm) => unknown } | undefined;
	return { hike, post: plainDeep(node?.toJS?.(fm) ?? null) };
}

export function clientDoc(doc: HikeDoc): ClientDoc {
	const fields: Record<string, unknown> = {};
	const texts: ClientDoc['texts'] = {};
	for (const decl of FIELDS) {
		if (isMapField(decl)) {
			const hike = readField(doc, decl);
			const post = decl.postOverride ? readField(doc, decl, 'post') : undefined;
			fields[decl.id] = { hike, ...(post !== undefined ? { post } : {}) };
			continue;
		}
		const v = decl.translated ? englishText(readField(doc, decl)) : readField(doc, decl);
		if (v !== undefined) fields[decl.id] = v;
		if (decl.translated) {
			const raw = readField(doc, decl);
			const t = typeof raw === 'string' ? { en: raw } : raw && typeof raw === 'object' ? raw : {};
			texts[decl.id] = Object.fromEntries(Object.entries(t).filter(([, x]) => typeof x === 'string')) as ClientDoc['texts'][string];
		}
	}
	return {
		kind: doc.date === null ? 'hike' : 'post',
		slug: doc.slug,
		date: doc.date,
		version: doc.version,
		fields,
		texts,
		mirrors: doc.postRaw === null ? [] : mirrorRows(postSources(doc.postRaw)),
		files: null,
		body: doc.postRaw === null ? null : readFrontmatterDoc(doc.postRaw).body,
		facts: factsOf(doc)
	};
}

/** Writes every `[file, data]` to a temp name first (`<file>.<pid>.tmp`), then renames all; on any error nothing changes. */
export function writeAllAtomic(items: [string, Buffer | string][]): void {
	const tmps: string[] = [];
	try {
		for (const [file, data] of items) {
			mkdirSync(path.dirname(file), { recursive: true });
			const tmp = `${file}.${process.pid}.tmp`;
			tmps.push(tmp);
			writeFileSync(tmp, data);
		}
		items.forEach(([file], i) => renameSync(tmps[i], file));
	} catch (e) {
		for (const t of tmps) {
			try {
				unlinkSync(t);
			} catch {
				/* already renamed or never written */
			}
		}
		throw e;
	}
}

/** One file's writeAllAtomic. */
export const writeAtomic = (file: string, text: string): void => writeAllAtomic([[file, text]]);

export type SaveResult = { ok: true; doc: ClientDoc } | { ok: false; doc: ClientDoc };

/** Applies `ops` if `base` is still the on-disk version; writes only the files that changed. */
export function saveOps(
	root: string,
	slug: string,
	date: string | null,
	base: string,
	ops: FieldOp[]
): SaveResult {
	const cur = loadDoc(root, slug, date);
	if (cur.version !== base) return { ok: false, doc: clientDoc(cur) };
	const next = applyOps(cur, ops);
	if (next.sidecarRaw !== cur.sidecarRaw) writeAtomic(sidecarPath(root, slug), next.sidecarRaw);
	if (next.postRaw !== null && next.postRaw !== cur.postRaw && date !== null)
		writeAtomic(postPath(root, slug, date), next.postRaw);
	return { ok: true, doc: clientDoc(next) };
}

import { Scalar, YAMLMap, YAMLSeq, isMap, isScalar, isSeq, type Document } from 'yaml';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { planMirrorRows, type MirrorRow } from './mirrors';
import { docVersion, type HikeDoc } from '../server/doc';
import { editSidecar, type SidecarEdit } from '../server/sidecar-file';
import { parse } from 'jsonc-parser';
import { ApiError } from '../server/errors';
import { FIELDS, PLACE_FIELDS, isMapField, type FieldDecl } from './fields';
import { applyFactsEdit, textValue } from './facts-edit';
import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';

export type FieldOp =
	/** `lang` (a translated field only): edit that language's text and keep the others; without it, the English. */
	| { field: string; value: unknown; scope?: 'hike' | 'post'; lang?: Lang }
	| { kind: 'mirrors'; rows: MirrorRow[] }
	/** The markdown body: everything after the front matter's closing `---\n`, byte for byte. */
	| { kind: 'body'; text: string }
	/**
	 * One value under `facts` (`path` is relative to it) in the sidecar (`hike`) or the post (`post`): `remove` deletes the
	 * key or list item, else `value` is set; `null` (the merge's "remove the hike's value") only in a post.
	 */
	| { kind: 'facts'; scope: 'hike' | 'post'; path: (string | number)[]; value?: unknown; remove?: true };

/**
 * Keeps the front matter bytes of `raw` and puts `text` after them, unchanged (no newline added or normalised).
 * Only a closing `---` at the end of the file gets its newline back when text follows it.
 */
export function replaceBody(raw: string, text: string): string {
	const { body } = readFrontmatterDoc(raw);
	const front = raw.slice(0, raw.length - body.length);
	if (!front) throw new ApiError(400, 'The file has no front matter to keep; refusing to save the text');
	return front && !front.endsWith('\n') && text ? `${front}\n${text}` : front + text;
}

/** null / "" / [] (after normalising chips) mean "remove the key"; for a required field a whitespace-only string does too. */
function normalise(value: unknown, required = false): unknown | undefined {
	if (value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const item of value) {
			const s = String(item).trim();
			const k = s.toLowerCase();
			if (!s || seen.has(k)) continue;
			seen.add(k);
			out.push(s);
		}
		return out.length ? out : undefined;
	}
	if (typeof value === 'string') return (required ? value.trim() : value) === '' ? undefined : value;
	return value;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a map field value (400 when bad); null / empty means "remove the key" and comes back undefined. */
function mapValue(decl: FieldDecl, value: unknown): unknown | undefined {
	if (value === null || value === undefined) return undefined;
	const bad = (why: string): never => {
		throw new ApiError(400, `${decl.label}: ${why}`);
	};
	switch (decl.kind) {
		case 'origin': {
			const o = value as { lat?: unknown; lon?: unknown };
			if (typeof value !== 'object' || !finite(o.lat) || !finite(o.lon)) return bad('needs a numeric lat and lon');
			if (o.lat < -90 || o.lat > 90) return bad('lat must be within -90..90');
			if (o.lon < -180 || o.lon > 180) return bad('lon must be within -180..180');
			return { lat: o.lat, lon: o.lon };
		}
		case 'number':
			if (!Number.isInteger(value) || (value as number) < 128 || (value as number) > 2048) return bad('must be a whole number from 128 to 2048');
			return value;
		case 'points': {
			if (!Array.isArray(value)) return bad('must be a list of [lon, lat] pairs');
			if (!value.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) return bad('every checkpoint must be a finite [lon, lat] pair');
			return value.length ? value.map((p) => [p[0], p[1]]) : undefined;
		}
		case 'refs': {
			if (!Array.isArray(value)) return bad('must be a list of node/way/relation refs');
			const seen = new Set<string>();
			for (const r of value) {
				if (typeof r !== 'string' || !/^(node|way|relation)\/\d+$/.test(r)) return bad(`bad OSM ref ${JSON.stringify(r)}`);
				if (seen.has(r)) return bad(`duplicate ref ${r}`);
				seen.add(r);
			}
			return value.length ? value : undefined;
		}
	}
	return value;
}

/** Front matter node for a map value: origin as a flow map, each checkpoint as a flow pair. */
function mapNode(fm: Document, decl: FieldDecl, value: unknown, old?: unknown): unknown {
	if (decl.kind === 'origin') {
		const map = fm.createNode(value) as YAMLMap;
		map.flow = true;
		return map;
	}
	if (decl.kind === 'points') {
		const seq = fm.createNode(value) as YAMLSeq;
		// Pairs equal to an old one (each used once) keep their node, hence their number spelling.
		const oldItems = isSeq(old) ? [...old.items] : [];
		seq.items = seq.items.map((pair, i) => {
			const j = oldItems.findIndex((o) => o !== null && isDeepEqual(isSeq(o) ? o.toJS(fm) : undefined, (value as unknown[])[i]));
			if (j >= 0) return oldItems.splice(j, 1, null as never)[0];
			if (isSeq(pair)) pair.flow = true;
			return pair;
		});
		return seq;
	}
	return value;
}

/** `{title: Komoot, url: '…', kind: mirror}`: only the URL is quoted, as in existing posts. */
function mirrorEntry(fm: Document, m: { title: string; url: string }): YAMLMap {
	const map = fm.createNode({}) as YAMLMap;
	map.flow = true;
	map.set('title', new Scalar(m.title));
	const url = new Scalar(m.url);
	url.type = Scalar.QUOTE_SINGLE;
	map.set('url', url);
	map.set('kind', new Scalar('mirror'));
	return map;
}

/** Rewrites `facts.sources` in place: untouched entries keep their nodes (and bytes), new mirrors are flow maps. */
function applyMirrors(fm: Document, rows: MirrorRow[]): void {
	const seq = fm.getIn(['facts', 'sources'], true);
	const old = isSeq(seq) ? seq.items : [];
	const plain = isSeq(seq) ? (seq.toJS(fm) as unknown[]) : [];
	const plan = planMirrorRows(plain, rows);
	const next = plan.map((p) => p.item);
	if (next.length === plain.length && next.every((n, i) => n === plain[i])) return;
	if (next.length === 0) {
		fm.deleteIn(['facts', 'sources']);
		if (fm.hasIn(['facts']) && (fm.getIn(['facts']) as any)?.items?.length === 0) fm.deleteIn(['facts']);
		return;
	}
	const items = plan.map(({ item, from }) => {
		if (from === null) return mirrorEntry(fm, item as { title: string; url: string });
		const node = old[from];
		if (item !== plain[from] && isMap(node)) {
			for (const k of ['title', 'url'] as const) {
				const cur = node.get(k, true);
				const v = (item as Record<string, string>)[k];
				if (isScalar(cur)) cur.value = v;
				else node.set(k, v);
			}
		}
		return node;
	});
	if (isSeq(seq)) {
		seq.items = items as typeof seq.items;
		return;
	}
	const node = fm.createNode([]);
	node.items = items as typeof node.items;
	if (fm.hasIn(['facts']) && isMap(fm.get('facts', true))) {
		fm.setIn(['facts', 'sources'], node);
	} else if (isMap(fm.contents)) {
		const at = fm.contents.items.findIndex((p) => isScalar(p.key) && p.key.value === 'images');
		const pair = fm.createPair('facts', fm.createNode({ sources: node }));
		if (at >= 0) fm.contents.items.splice(at, 0, pair);
		else fm.contents.items.push(pair);
	} else {
		fm.setIn(['facts', 'sources'], node);
	}
}

/** Sets a front matter value; a new top-level key goes before `images:` when present, else at the end. */
export function setFrontmatterValue(fm: Document, path: string[], value: unknown): void {
	if (fm.hasIn(path)) {
		fm.setIn(path, value);
		return;
	}
	const node = fm.createNode(value);
	if (path.length === 1 && isMap(fm.contents)) {
		const items = fm.contents.items;
		const at = items.findIndex((p) => isScalar(p.key) && p.key.value === 'images');
		const pair = fm.createPair(path[0], node);
		if (at >= 0) items.splice(at, 0, pair);
		else items.push(pair);
	} else {
		fm.setIn(path, node);
	}
}

const isDeepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The sidecar edit for a translated field: the English inside a value that is already a map, so every other language
 * stays; a plain string (or nothing) becomes `{en}`. With `lang`, that language's text instead (undefined clears it),
 * by the Text rule of the Facts tab.
 */
function translatedEdit(sidecarRaw: string, decl: FieldDecl, value: unknown, lang?: Lang): SidecarEdit {
	let cur: unknown = parse(sidecarRaw);
	for (const k of decl.path) cur = (cur as Record<string, unknown> | undefined)?.[k];
	const isMap = !!cur && typeof cur === 'object' && !Array.isArray(cur);
	if (lang) {
		const next = textValue(cur, { [lang]: (value as string | undefined) ?? '' }, decl.label);
		// Within a map only the language's own key changes; a string becoming a map is written whole.
		return isMap && next !== undefined ? { path: [...decl.path, lang], value } : { path: decl.path, value: next };
	}
	const translations = isMap ? Object.keys(cur as object).filter((k) => k !== 'en') : [];
	if (value === undefined) {
		if (translations.length) throw new ApiError(400, `${decl.label}: the English text is required while the file has a translation (${translations.join(', ')})`);
		return { path: decl.path, value };
	}
	return isMap ? { path: [...decl.path, 'en'], value } : { path: decl.path, value: { en: value } };
}

export function applyOps(doc: HikeDoc, ops: FieldOp[]): HikeDoc {
	let sidecarRaw = doc.sidecarRaw;
	let postRaw = doc.postRaw;
	for (const op of ops) {
		if ('kind' in op && op.kind === 'body') {
			if (postRaw === null) throw new ApiError(400, 'No post to edit for the text');
			postRaw = replaceBody(postRaw, op.text);
			continue;
		}
		if ('kind' in op && op.kind === 'facts') {
			if (op.scope === 'hike') {
				sidecarRaw = applyFactsEdit(sidecarRaw, 'sidecar', op);
				continue;
			}
			if (op.scope !== 'post') throw new ApiError(400, `Bad scope: ${String(op.scope)}`);
			if (postRaw === null) throw new ApiError(400, 'No post to edit for facts');
			postRaw = applyFactsEdit(postRaw, 'post', op);
			continue;
		}
		if ('kind' in op) {
			if (postRaw === null) throw new ApiError(400, 'No post to edit for mirrors');
			const { doc: fm, body } = readFrontmatterDoc(postRaw);
			applyMirrors(fm, op.rows);
			postRaw = writeFrontmatterDoc(fm, body);
			continue;
		}
		const decl = FIELDS.find((f) => f.id === op.field);
		if (!decl) throw new ApiError(400, `Unknown field: ${op.field}`);
		if (op.scope !== undefined && op.scope !== 'hike' && op.scope !== 'post') throw new ApiError(400, `Bad scope: ${String(op.scope)}`);
		const post = op.scope === 'post';
		if (post && !decl.postOverride) throw new ApiError(400, `${op.field} has no post override`);
		if (op.lang !== undefined && !(decl.translated && (OTHER_LANGS as readonly string[]).includes(op.lang)))
			throw new ApiError(400, `${op.field} has no ${String(op.lang)} text`);
		const value = isMapField(decl) ? mapValue(decl, op.value) : normalise(op.value, decl.required);
		if (decl.file === 'sidecar' && !post) {
			sidecarRaw = editSidecar(sidecarRaw, [decl.translated ? translatedEdit(sidecarRaw, decl, value, op.lang) : { path: decl.path, value }]);
			continue;
		}
		if (postRaw === null) throw new ApiError(400, `No post to edit for ${op.field}`);
		const { doc: fm, body } = readFrontmatterDoc(postRaw);
		if (value === undefined) {
			fm.deleteIn(decl.path);
		} else if (isMapField(decl)) {
			const cur = fm.getIn(decl.path, true) as { toJS?: (d: Document) => unknown; items?: unknown[] } | undefined;
			if (!isDeepEqual(cur?.toJS?.(fm), value)) setFrontmatterValue(fm, decl.path, mapNode(fm, decl, value, cur));
		} else {
			setFrontmatterValue(fm, decl.path, value);
		}
		postRaw = writeFrontmatterDoc(fm, body);
	}
	return { ...doc, sidecarRaw, postRaw, version: docVersion(sidecarRaw, postRaw) };
}

/** Applies field and body ops to a place doc's raw text; front matter keys only from PLACE_FIELDS. */
export function applyPlaceOps(raw: string, ops: FieldOp[]): string {
	return applyMarkdownOps(raw, ops, PLACE_FIELDS, { doc: 'A place doc', field: 'place field' });
}

/**
 * Applies field and body ops to a markdown doc of its own (a place doc, a translation): front matter keys only from
 * `fields`; `names` words the refusals.
 */
export function applyMarkdownOps(raw: string, ops: FieldOp[], fields: FieldDecl[], names: { doc: string; field: string }): string {
	for (const op of ops) {
		if ('kind' in op) {
			if (op.kind !== 'body') throw new ApiError(400, `${names.doc} has no ${op.kind}`);
			raw = replaceBody(raw, op.text);
			continue;
		}
		const decl = fields.find((f) => f.id === op.field);
		if (!decl) throw new ApiError(400, `Unknown ${names.field}: ${op.field}`);
		if (op.scope !== undefined) throw new ApiError(400, `${op.field} has no scope`);
		if (op.lang !== undefined) throw new ApiError(400, `${op.field} has no ${String(op.lang)} text`);
		const value = normalise(op.value, decl.required);
		if (decl.required && value === undefined) throw new ApiError(400, `${decl.label} is required`);
		const { doc: fm, body } = readFrontmatterDoc(raw);
		const cur = fm.getIn(decl.path, true) as { toJS?: (d: Document) => unknown } | undefined;
		// An unchanged value keeps its node, hence its spelling (`tags: [Hut, DAV]` stays a flow list).
		if (isDeepEqual(cur?.toJS?.(fm), value)) continue;
		if (value === undefined) fm.deleteIn(decl.path);
		else setFrontmatterValue(fm, decl.path, value);
		raw = writeFrontmatterDoc(fm, body);
	}
	return raw;
}

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { parseTranslation } from '../../../src/lib/hikes/translations.server';
import { ApiError } from './errors';
import { plain, versionOf, writeAtomic } from './doc';
import { docFile, type DocRef } from './doc-ref';
import { translationFields } from '../shared/fields';
import { applyMarkdownOps, type FieldOp } from '../shared/ops';

export type TranslationRef = Extract<DocRef, { kind: 'translation' }>;

/** A translation as on disk (`<source>.<lang>.md`); one not made yet is `exists: false` with an empty text. */
export type TranslationDoc = { ref: TranslationRef; exists: boolean; raw: string; version: string };

/** What the browser sees for a translation: its texts and body only, the rest is the English file's. */
export type TranslationClientDoc = { kind: 'translation'; exists: boolean; version: string; fields: Record<string, unknown>; body: string };

const fileOf = (root: string, ref: TranslationRef): string => docFile(root, ref)!;

/** 400 when the English file is gone (renamed or deleted): a translation is made and edited only beside its source. */
function needSource(root: string, ref: TranslationRef): void {
	const source = docFile(root, ref.source)!;
	if (!existsSync(source)) throw new ApiError(400, `No ${path.basename(source)} to translate`);
}

export function loadTranslation(root: string, ref: TranslationRef): TranslationDoc {
	const file = fileOf(root, ref);
	const exists = existsSync(file);
	const raw = exists ? readFileSync(file, 'utf8') : '';
	return { ref, exists, raw, version: versionOf(raw) };
}

export function translationClientDoc(doc: TranslationDoc): TranslationClientDoc {
	const { doc: fm, body } = readFrontmatterDoc(doc.raw);
	const fields: Record<string, unknown> = {};
	for (const decl of translationFields(doc.ref.source.kind)) {
		const js = (fm.getIn(decl.path, true) as any)?.toJS?.(fm);
		if (js !== undefined && js !== null) fields[decl.id] = Array.isArray(js) ? js.map(plain) : plain(js);
	}
	return { kind: 'translation', exists: doc.exists, version: doc.version, fields, body };
}

export type TranslationSaveResult = { ok: boolean; doc: TranslationClientDoc };

/**
 * Applies `ops` if `base` is still the on-disk version; writes only when the text changed. A blank text removes its
 * key (the site refuses an empty one), and a result the site wouldn't read is refused with its message. 400 when
 * its source is missing.
 */
export function saveTranslationOps(root: string, ref: TranslationRef, base: string, ops: FieldOp[]): TranslationSaveResult {
	needSource(root, ref);
	const cur = loadTranslation(root, ref);
	if (cur.version !== base) return { ok: false, doc: translationClientDoc(cur) };
	if (!cur.exists) throw new ApiError(404, `No translation ${path.basename(fileOf(root, ref))}: create it first`);
	const blank = (op: FieldOp): FieldOp => ('field' in op && typeof op.value === 'string' && !op.value.trim() ? { ...op, value: null } : op);
	const raw = applyMarkdownOps(cur.raw, ops.map(blank), translationFields(ref.source.kind), { doc: 'A translation', field: 'translation field' });
	if (raw === cur.raw) return { ok: true, doc: translationClientDoc(cur) };
	try {
		parseTranslation(path.basename(fileOf(root, ref)), raw, ref.source.kind);
	} catch (e) {
		throw new ApiError(400, e instanceof Error ? e.message : String(e));
	}
	writeAtomic(fileOf(root, ref), raw);
	return { ok: true, doc: translationClientDoc({ ref, exists: true, raw, version: versionOf(raw) }) };
}

/**
 * A new translation with no texts yet: an empty front matter, `---\n---\n` (never empty keys, which the site refuses).
 * 400 when its source is missing, 409 when the file exists.
 */
export function createTranslation(root: string, ref: TranslationRef): TranslationClientDoc {
	needSource(root, ref);
	const file = fileOf(root, ref);
	// `wx`: created whole or not at all, never over a file made meanwhile.
	try {
		writeFileSync(file, '---\n---\n', { flag: 'wx' });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError(409, `${path.basename(file)} already exists`);
		throw e;
	}
	return translationClientDoc(loadTranslation(root, ref));
}

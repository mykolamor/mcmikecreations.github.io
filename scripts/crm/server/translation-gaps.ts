// Which parts of a doc still lack a translation, per language: what the Open screen's badges and the tab dots show.
// It asks Fill's own gather functions, so "missing" here is what "Fill empty from English" would fill.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FACTS, type Spec } from '$lib/hikes/facts-spec';
import type { FactsLibrary } from '$lib/hikes/facts-library.server';
import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';
import { GAP_PARTS, type GapPart, type Gaps } from '../shared/translation-gaps';
import { isObject } from '../shared/tree';
import { readFactsLibraryFile } from '../lib/facts-library-file';
import { readFrontmatterDoc } from '../lib/frontmatter';
import { textParts } from '../web/facts/form-model';
import { recordOf } from '../web/facts/shared';
import { gatherDoc, gatherFacts, gatherRecord, gatherRoute } from '../web/fill/fill';
import { postPath, sidecarPath } from './doc';
import type { EnglishRef } from './doc-ref';
import { repoPaths } from './paths';

/** The facts library, or null when unreadable (`crm check` reports that): then no record counts. */
export function readLibrary(root: string): FactsLibrary | null {
	try {
		return readFactsLibraryFile(root);
	} catch {
		return null;
	}
}

/** A shared record's text counts unless the entry states that field itself: then the entry's own text is what shows. */
function recordGap(value: unknown, spec: Spec | undefined, lang: Lang, library: FactsLibrary): boolean {
	if (value == null || !spec) return false;
	if (spec.t === 'obj') return isObject(value) && Object.entries(value).some(([k, v]) => recordGap(v, spec.f[k], lang, library));
	if (spec.t !== 'list' || !Array.isArray(value)) return false;
	const { lib } = spec;
	return value.some((entry) => {
		const record = lib ? recordOf(lib, entry, library) : undefined;
		if (record && lib && gatherRecord(record, lang, lib).some((item) => !(JSON.parse(item.id)[0] in (entry as object)))) return true;
		return recordGap(entry, spec.of, lang, library);
	});
}

/** Facts with a text in English and not in `lang`: their own, or that of a shared record they take. */
export function factsGap(facts: unknown, lang: Lang, library: FactsLibrary | null): boolean {
	return gatherFacts(facts, lang).length > 0 || (!!library && recordGap(facts, FACTS, lang, library));
}

const byLang = (parts: (lang: Lang) => Set<GapPart>): Gaps => {
	const gaps: Gaps = {};
	for (const lang of OTHER_LANGS) {
		const found = parts(lang);
		if (found.size) gaps[lang] = GAP_PARTS.filter((p) => found.has(p));
	}
	return gaps;
};

/** A hike's sidecar, as parsed: its facts and its route words (name, description). */
export function sidecarGaps(sidecar: Record<string, unknown>, library: FactsLibrary | null): Gaps {
	const words = { name: textParts(sidecar.name), description: textParts(sidecar.description) };
	return byLang((lang) => {
		const found = new Set<GapPart>();
		if (factsGap(sidecar.facts, lang, library)) found.add('facts');
		if (gatherRoute(words, lang).length) found.add('details');
		return found;
	});
}

function readFront(raw: string): { fields: Record<string, unknown>; body: string } {
	try {
		const { doc, body } = readFrontmatterDoc(raw);
		return { fields: (doc.toJS() ?? {}) as Record<string, unknown>, body };
	} catch {
		return { fields: {}, body: raw };
	}
}

/** A post or place doc, by its file: its own facts, its body and its title and description, against `<file>.<lang>.md`. */
export function fileGaps(file: string, library: FactsLibrary | null): Gaps {
	let en: { fields: Record<string, unknown>; body: string };
	try {
		en = readFront(readFileSync(file, 'utf8'));
	} catch {
		return {}; // unreadable: `crm check` reports it
	}
	const stem = file.slice(0, -'.md'.length);
	return byLang((lang) => {
		const found = new Set<GapPart>();
		const trFile = `${stem}.${lang}.md`;
		const tr = existsSync(trFile) ? readFront(readFileSync(trFile, 'utf8')) : { fields: {}, body: '' };
		for (const item of gatherDoc(en.body, tr.body, tr.fields, en.fields)) found.add(item.id.startsWith('tr.') ? 'details' : 'text');
		if (factsGap(en.fields.facts, lang, library)) found.add('facts');
		return found;
	});
}

function merge(a: Gaps, b: Gaps): Gaps {
	return byLang((lang) => new Set([...(a[lang] ?? []), ...(b[lang] ?? [])]));
}

function readSidecar(root: string, slug: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(sidecarPath(root, slug), 'utf8'));
	} catch {
		return {};
	}
}

/** The doc as its tabs show it: a post with its hike's sidecar, a hike alone, or a place doc. */
export function docGaps(root: string, ref: EnglishRef): Gaps {
	const library = readLibrary(root);
	if (ref.kind === 'place') return fileGaps(path.join(repoPaths(root).places, `${ref.slug}.md`), library);
	const sidecar = sidecarGaps(readSidecar(root, ref.slug), library);
	return ref.kind === 'hike' ? sidecar : merge(sidecar, fileGaps(postPath(root, ref.slug, ref.date), library));
}

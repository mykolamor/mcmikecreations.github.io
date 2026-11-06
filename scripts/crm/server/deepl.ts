// DeepL (API v2) for the translation drafts: English texts in, the second language out, in batches of at most 50.
// What must come back byte for byte (photo and video markup and targets, but not their captions, link targets, URLs, place mentions, code, HTML tags, `{name}`
// placeholders, the markdown at line starts) is sent as `<x id="N"/>` placeholders, which DeepL keeps with
// `tag_handling: 'xml'` and `ignore_tags: ['x']`, and put back after; an answer that loses or changes one is refused, as is one
// that drops a link's `[` (not a placeholder) or makes up markup of its own.
// The key goes only into the Authorization header and is never logged or put into a message.
import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';
import { LEADING_ENGLISH, TOPONYM } from '../../../src/lib/hikes/hikes-info';
import { mediaLines } from '../shared/md-lines';
import { NO_KEY, deeplTarget } from '../shared/deepl-langs';

export { NO_KEY, deeplTarget };

export const FREE_URL = 'https://api-free.deepl.com/v2/translate';
export const PRO_URL = 'https://api.deepl.com/v2/translate';
/** DeepL takes at most this many texts per request. */
export const BATCH = 50;
export const TIMEOUT_MS = 60_000;

export type TextKind = 'markdown' | 'plain' | 'table';
export type DeeplText = { id: string; text: string; kind: TextKind };
export type DeeplDeps = { key: string; fetch: typeof fetch };
export type DeeplResult = {
	texts: { id: string; text: string }[];
	refused: { id: string; reason: string }[];
};
export type DeeplErrorKind = 'quota' | 'rate' | 'http' | 'network';

/** DeepL answered with an error, or couldn't be reached. Its message never holds the key. */
export class DeeplError extends Error {
	constructor(
		public kind: DeeplErrorKind,
		message: string
	) {
		super(message);
		this.name = 'DeeplError';
	}
}

/** The site's languages DeepL can fill. */
export const deeplLangs = (): Lang[] => OTHER_LANGS.filter((l) => deeplTarget(l) !== null);

type Range = { from: number; to: number };

/** Markdown at a line's start: headings, quotes, list markers, with their indent and the space after. */
const STRUCTURE = /^[ \t]*(?:(?:#{1,6}|[-*+]|\d+[.)])[ \t]+|>[ \t]*)+/;
const CODE = /`[^`\n]+`/g;
const HTML = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>\n]*>/g;
/** The `](target "title")` of a link; one level of parentheses in the target, as in Wikipedia URLs. */
const LINK_TARGET = /\]\((?:<[^<>\n]*>|(?:[^\s()<>]|\([^\s()<>]*\))+)(?:[ \t]+"[^"\n]*")?\)/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]`]*[^\s<>()[\]`.,;:!?'"]/g;
const PLACEHOLDER = /\{\w+\}/g;

/** Protected ranges, earlier ones winning over later ones they overlap. */
class Ranges {
	list: Range[] = [];
	/** The line-start markers taken, which must stay at a line's start. */
	starts = new Set<Range>();
	take(from: number, to: number): Range | null {
		if (to <= from || this.list.some((r) => r.from < to && from < r.to)) return null;
		const range = { from, to };
		this.list.push(range);
		return range;
	}
	all(text: string, re: RegExp): void {
		for (const m of text.matchAll(re)) this.take(m.index!, m.index! + m[0].length);
	}
}

function markdownRanges(text: string): Ranges {
	const r = new Ranges();
	// A photo or video line but its caption: from the line's start through `![`, and from `](target)` to its end. The
	// caption is translated (a link, mention or URL in it protected below); the `![` must still open its line.
	for (const m of mediaLines(text)) {
		const end = text.indexOf('\n', m.to);
		const to = end === -1 ? text.length : end;
		const head = r.take(text.lastIndexOf('\n', m.from - 1) + 1, m.captionFrom);
		if (head) r.starts.add(head);
		r.take(m.captionTo, text[to - 1] === '\r' ? to - 1 : to);
	}
	let at = 0;
	for (const line of text.split('\n')) {
		const m = STRUCTURE.exec(line);
		const range = m && r.take(at, at + m[0].length);
		if (range) r.starts.add(range);
		at += line.length + 1;
	}
	for (const re of [CODE, HTML, LINK_TARGET, URL, PLACEHOLDER]) r.all(text, re);
	// `Name (1234 m)` whole, less the English words a sentence starts it with ("After Knorrhütte (2052 m)").
	for (const m of text.matchAll(TOPONYM)) {
		let from = m.index!;
		let rest = m[0];
		for (
			let w = /^(\S+)\s+/.exec(rest);
			w && LEADING_ENGLISH.has(w[1]) && !rest.slice(w[0].length).startsWith('(');
			w = /^(\S+)\s+/.exec(rest)
		) {
			from += w[0].length;
			rest = rest.slice(w[0].length);
		}
		r.take(from, m.index! + m[0].length);
	}
	return r;
}

/** The balanced `{…}` spans of a table string that are placeholders: `{name}`, or a whole `{name, select|plural, …}`. */
function braceSpans(text: string): { from: number; to: number; form: boolean }[] {
	const out: { from: number; to: number; form: boolean }[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '{') continue;
		let depth = 0;
		let close = -1;
		for (let j = i; j < text.length && close === -1; j++) {
			if (text[j] === '{') depth++;
			else if (text[j] === '}' && --depth === 0) close = j;
		}
		if (close === -1) break;
		const m = /^\{\s*\w+\s*(,\s*(?:select|plural)\s*,[\s\S]*)?\}$/.exec(text.slice(i, close + 1));
		if (m) {
			out.push({ from: i, to: close + 1, form: !!m[1] });
			i = close;
		}
	}
	return out;
}

/**
 * A table string's whole `{name, select|plural, …}` forms (the author edits those by hand), then its link targets and
 * URLs as in a post (a `{name}` inside one goes with it), then the bare `{name}` placeholders left.
 */
function tableRanges(text: string): Ranges {
	const r = new Ranges();
	const spans = braceSpans(text);
	for (const s of spans) if (s.form) r.take(s.from, s.to);
	for (const re of [LINK_TARGET, URL]) r.all(text, re);
	for (const s of spans) if (!s.form) r.take(s.from, s.to);
	return r;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escape = (s: string) => s.replace(/[&<>]/g, (c) => ESCAPES[c]);
const UNESCAPES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** The named entities above and numeric references, `&#39;` and `&#x27;`. */
const unescape = (s: string) =>
	s.replace(
		/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
		(all, e?: string, dec?: string, hex?: string) => {
			if (e) return UNESCAPES[e];
			const code = dec ? Number(dec) : parseInt(hex!, 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : all;
		}
	);

/**
 * `text` as DeepL gets it: `&`, `<` and `>` escaped, and each protected span replaced by `<x id="N"/>`, N its index
 * in `spans`. `plain` protects only URLs and `{name}`; `table` also select/plural forms and link targets.
 */
export function protect(
	text: string,
	kind: TextKind
): { tagged: string; spans: string[]; starts: number[] } {
	let ranges: Ranges;
	if (kind === 'markdown') ranges = markdownRanges(text);
	else if (kind === 'table') ranges = tableRanges(text);
	else {
		ranges = new Ranges();
		for (const re of [URL, PLACEHOLDER]) ranges.all(text, re);
	}
	const spans: string[] = [];
	const starts: number[] = [];
	let tagged = '';
	let at = 0;
	for (const range of ranges.list.sort((a, b) => a.from - b.from)) {
		tagged += escape(text.slice(at, range.from)) + `<x id="${spans.length}"/>`;
		if (ranges.starts.has(range)) starts.push(spans.length);
		spans.push(text.slice(range.from, range.to));
		at = range.to;
	}
	return { tagged: tagged + escape(text.slice(at)), spans, starts };
}

const TAG = /<x\s+id="(\d+)"\s*\/>|<x\s+id="(\d+)"\s*>\s*<\/x>/g;

/** `tagged` (DeepL's answer) un-escaped with its spans put back; null when a placeholder is missing, repeated, unknown or broken. */
export function restore(tagged: string, spans: string[]): string | null {
	const seen = new Set<number>();
	let out = '';
	let at = 0;
	const text = (s: string) => (/<\/?x\b/.test(s) ? null : unescape(s));
	for (const m of tagged.matchAll(TAG)) {
		const before = text(tagged.slice(at, m.index));
		const id = Number(m[1] ?? m[2]);
		if (before === null || id >= spans.length || seen.has(id)) return null;
		seen.add(id);
		out += before + spans[id];
		at = m.index! + m[0].length;
	}
	const rest = text(tagged.slice(at));
	if (rest === null || seen.size !== spans.length) return null;
	return out + rest;
}

const lineCount = (s: string) => s.split('\n').length;
/** Each line-start marker's placeholder still opens a line of `tagged` (DeepL's answer). */
const markersKept = (tagged: string, starts: number[]): boolean =>
	starts.every((id) => {
		const m = new RegExp(`<x\\s+id="${id}"`).exec(tagged);
		return !!m && (m.index === 0 || tagged[m.index - 1] === '\n');
	});
/** The photo and video lines of `restored` are `source`'s, the same targets in the same order (their captions may differ). */
const sameMedia = (source: string, restored: string): boolean => {
	const hrefs = (s: string) => mediaLines(s).map((m) => m.href).join('\n');
	return hrefs(source) === hrefs(restored);
};
/**
 * The links of `restored` are `source`'s: the same targets, each still opened by its `[`. Only a link's target is a
 * placeholder, so DeepL can drop or move the `[` (and the words around it) with every placeholder still in place.
 */
const sameLinks = (source: string, restored: string): boolean => {
	const targets = (s: string) => [...s.matchAll(/\[[^[\]]*(\]\((?:<[^<>\n]*>|(?:[^\s()<>]|\([^\s()<>]*\))+)(?:[ \t]+"[^"\n]*")?\))/g)].map((m) => m[1]).sort();
	const [a, b] = [targets(source), targets(restored)];
	const brackets = (s: string) => s.replace(/[^[\]]/g, '').length;
	return a.length === b.length && a.every((t, i) => t === b[i]) && brackets(source) === brackets(restored);
};
/** `restored` has a `<` that `source` hasn't: markup DeepL made up (sent back escaped, so `restore` let it through). */
const addedMarkup = (source: string, restored: string): boolean => restored.split('<').length > source.split('<').length;
/** A line of `text` whose line break means something: a hard break, a list item's or code's indent, a table, a fence. */
const fixedLines = (text: string, tagged: string, starts: number[]): boolean => {
	if (/```|(?: {2}|\\)\r?\n/.test(text)) return true;
	return tagged.split('\n').some((line) => !startOf(line, starts) && /^(?:[ \t]|\|)/.test(line));
};

/** The line-start marker `line` opens with, if any. */
const startOf = (line: string, starts: number[]): number | null => {
	const id = /^<x id="(\d+)"\/>/.exec(line)?.[1];
	return id !== undefined && starts.includes(Number(id)) ? Number(id) : null;
};

/** `unit` (one line) in `count` lines of about the same length, never with a line that would start a list or heading. */
function wrapLines(unit: string, count: number): string[] {
	const words = unit.split(/ (?!id=")/);
	const total = unit.length;
	const lines: string[] = [];
	let line: string[] = [];
	let used = 0;
	words.forEach((word, i) => {
		line.push(word);
		used += word.length + 1;
		const breaks = count - lines.length - 1;
		const next = words[i + 1];
		if (breaks > 0 && next !== undefined && !STRUCTURE.test(`${next} `) && (used >= (total * (lines.length + 1)) / count || words.length - i - 1 <= breaks)) {
			lines.push(line.join(' '));
			line = [];
		}
	});
	return [...lines, line.join(' ')];
}

/**
 * DeepL's `answer` with the line structure of the source (`tagged`): DeepL likes to break a line around a placeholder,
 * which is noise in a paragraph and fatal in a photo line. Its line breaks are dropped, spaces inside a caption's or
 * link's brackets and before punctuation with them; each line-start marker opens a line again, in the source's order,
 * and what follows it fills as many lines as it had. Null when that structure can't be rebuilt.
 */
export function relayout(answer: string, tagged: string, spans: string[], starts: number[]): string | null {
	if (spans.some((s) => s.includes('\n'))) return null;
	type Part = { tag: number } | { text: string } | { space: true };
	const parts: Part[] = [];
	let at = 0;
	for (const m of answer.matchAll(/<x\s+id="(\d+)"\s*\/>|<x\s+id="(\d+)"\s*>\s*<\/x>|[ \t\r\n]+/g)) {
		if (m.index > at) parts.push({ text: answer.slice(at, m.index) });
		const id = m[1] ?? m[2];
		parts.push(id === undefined ? { space: true } : { tag: Number(id) });
		at = m.index + m[0].length;
	}
	if (at < answer.length) parts.push({ text: answer.slice(at) });
	const out = parts.map((part, i) => {
		if ('tag' in part) return `<x id="${part.tag}"/>`;
		if ('text' in part) return part.text;
		const [prev, next] = [parts[i - 1], parts[i + 1]];
		if (!prev || !next) return '';
		if ('tag' in next && starts.includes(next.tag)) return '\n';
		const opens = 'tag' in prev ? /[[\s]$/.test(spans[prev.tag] ?? '') : 'text' in prev && prev.text.endsWith('[');
		const closes = 'tag' in next ? (spans[next.tag] ?? '').startsWith(']') : 'text' in next && /^[,.;:!?)\]]/.test(next.text);
		return opens || closes ? '' : ' ';
	});
	const units = out.join('').split('\n');
	// How many lines each marker's part of the source has, and the marker it opens with.
	const source: { start: number | null; lines: number }[] = [];
	for (const line of tagged.split('\n')) {
		const start = startOf(line, starts);
		if (start !== null || !source.length) source.push({ start, lines: 1 });
		else source[source.length - 1].lines++;
	}
	if (units.length !== source.length) return null;
	const rebuilt: string[] = [];
	for (const [i, unit] of units.entries()) {
		if (startOf(unit, starts) !== source[i].start) return null;
		rebuilt.push(...wrapLines(unit, source[i].lines));
	}
	return rebuilt.join('\n');
}

/** Something to translate: a letter outside the placeholders. */
const hasWords = (tagged: string) => /\p{L}/u.test(tagged.replace(TAG, ''));
const isTimeout = (e: unknown): boolean =>
	e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** DeepL's own error text, if it sent one, without the key and kept short. */
async function detail(res: Response, key: string): Promise<string> {
	try {
		const m = ((await res.json()) as { message?: unknown }).message;
		return typeof m === 'string' && m ? `: ${m.split(key).join('…').slice(0, 200)}` : '';
	} catch {
		return '';
	}
}

async function request(texts: string[], target: string, deps: DeeplDeps): Promise<string[]> {
	const url = deps.key.endsWith(':fx') ? FREE_URL : PRO_URL;
	let res: Response;
	try {
		res = await deps.fetch(url, {
			method: 'POST',
			headers: { Authorization: `DeepL-Auth-Key ${deps.key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: texts,
				source_lang: 'EN',
				target_lang: target,
				tag_handling: 'xml',
				ignore_tags: ['x'],
				preserve_formatting: true
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		// The underlying error's text is left out: it may quote the request.
		throw new DeeplError(
			'network',
			isTimeout(e) ? 'DeepL unreachable (timeout)' : 'DeepL unreachable'
		);
	}
	if (res.status === 456)
		throw new DeeplError('quota', `DeepL quota exceeded${await detail(res, deps.key)}`);
	if (res.status === 429)
		throw new DeeplError(
			'rate',
			`DeepL: too many requests, try again in a moment${await detail(res, deps.key)}`
		);
	if (res.status === 403) throw new DeeplError('http', 'DeepL refused the key (HTTP 403)');
	if (!res.ok)
		throw new DeeplError('http', `DeepL answered HTTP ${res.status}${await detail(res, deps.key)}`);
	let answer: unknown;
	try {
		answer = await res.json();
	} catch {
		throw new DeeplError('http', 'DeepL answered something that is not JSON');
	}
	const list = (answer as { translations?: unknown })?.translations;
	if (
		!Array.isArray(list) ||
		list.length !== texts.length ||
		!list.every((t) => typeof t?.text === 'string')
	)
		throw new DeeplError(
			'http',
			`DeepL answered ${Array.isArray(list) ? list.length : 'no'} translations for ${texts.length} texts`
		);
	return list.map((t: { text: string }) => t.text);
}

/**
 * Translates `texts` from English into `lang`, in requests of at most 50 in order. The answers come back in the
 * order given; one whose placeholders DeepL changed, whose links lost a bracket, which gained markup, or whose lines it changed past `relayout`'s repair, is left out and listed in `refused`. A text with
 * nothing but protected spans isn't sent: it comes back as it is. Throws a `DeeplError` when a request fails.
 */
export async function translateBatch(
	texts: DeeplText[],
	lang: Lang,
	deps: DeeplDeps
): Promise<DeeplResult> {
	const target = deeplTarget(lang);
	if (!target) throw new Error(`DeepL doesn't translate into ${lang}`);
	const prepared = texts.map((t, at) => ({ ...t, ...protect(t.text, t.kind), at }));
	const answers = new Map<number, string>();
	const toSend = prepared.filter((p) => hasWords(p.tagged));
	for (let i = 0; i < toSend.length; i += BATCH) {
		const chunk = toSend.slice(i, i + BATCH);
		const got = await request(
			chunk.map((p) => p.tagged),
			target,
			deps
		);
		chunk.forEach((p, k) => answers.set(p.at, got[k]));
	}
	const out: DeeplResult = { texts: [], refused: [] };
	for (const p of prepared) {
		let answer = answers.get(p.at) ?? p.tagged;
		let restored = restore(answer, p.spans);
		if (restored !== null && lineCount(restored) !== lineCount(p.text) && p.kind === 'markdown' && !fixedLines(p.text, p.tagged, p.starts)) {
			const rebuilt = relayout(answer, p.tagged, p.spans, p.starts);
			if (rebuilt !== null) [answer, restored] = [rebuilt, restore(rebuilt, p.spans)];
		}
		if (restored === null)
			out.refused.push({
				id: p.id,
				reason: 'DeepL changed a protected part (a link, URL, photo line, place or placeholder)'
			});
		else if (addedMarkup(p.text, restored)) out.refused.push({ id: p.id, reason: 'DeepL added markup' });
		else if (!sameLinks(p.text, restored)) out.refused.push({ id: p.id, reason: 'DeepL broke a link' });
		else if (lineCount(restored) !== lineCount(p.text))
			out.refused.push({ id: p.id, reason: 'DeepL changed the line breaks' });
		else if (!markersKept(answer, p.starts))
			out.refused.push({ id: p.id, reason: 'DeepL moved a list or heading marker' });
		else if (p.kind === 'markdown' && !sameMedia(p.text, restored))
			out.refused.push({ id: p.id, reason: 'DeepL broke a photo or video line' });
		else out.texts.push({ id: p.id, text: restored });
	}
	return out;
}

/**
 * A stand-in for DeepL's endpoint (`CRM_DEEPL_STUB=1`, and the tests): each text comes back as `⟨de⟩ <text>`, tags
 * kept; the prefix goes after the placeholders a text starts with, so a heading's marker stays at its line start.
 */
export const deeplStub: typeof fetch = async (_url, init) => {
	const body = JSON.parse(String(init?.body)) as { text: string[]; target_lang: string };
	const lang = body.target_lang.toLowerCase();
	return new Response(
		JSON.stringify({
			translations: body.text.map((t) => ({
				detected_source_language: 'EN',
				text: t.replace(/^(?:<x id="\d+"\/>)*/, (lead) => `${lead}⟨${lang}⟩ `)
			}))
		}),
		{
			status: 200,
			headers: { 'content-type': 'application/json' }
		}
	);
};

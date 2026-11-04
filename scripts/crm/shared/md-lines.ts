/**
 * Reads the markdown structure the Write editor cares about (media lines,
 * missing links) and describes its edits as plain changes, free of CodeMirror:
 * replace `from`..`to` of the body with `insert`, then select `selFrom`..`selTo`
 * (offsets in the body after the change). The markdown forms are the ones the
 * existing posts use.
 */
import { nodeEle, type PlaceNode } from '$lib/hikes/place-links';

export interface MdChange {
	from: number;
	to: number;
	insert: string;
	selFrom: number;
	selTo: number;
}

export interface MediaLine {
	/** The line, without its line break. */
	from: number;
	to: number;
	kind: 'photo' | 'video' | 'youtube' | 'missing';
	/** The caption as written, markdown included. */
	caption: string;
	captionFrom: number;
	captionTo: number;
	/** The URL, without the `"autoplay"` title. */
	href: string;
}

/** Placeholder for media or a post that doesn't exist yet. */
export const MISSING_HREF = '/404/';

const isMissingHref = (href: string) => /^\/404\/?$/.test(href.trim());

/** The body's line break, from its first one: `\r\n` or `\n`. */
export function lineEnding(body: string): string {
	return /\r?\n/.exec(body)?.[0] ?? '\n';
}

/** Each line's start and end (before `\r\n` or `\n`). */
function lineSpans(body: string): { from: number; to: number }[] {
	const spans: { from: number; to: number }[] = [];
	let from = 0;
	for (;;) {
		const nl = body.indexOf('\n', from);
		const end = nl === -1 ? body.length : nl;
		spans.push({ from, to: end > from && body[end - 1] === '\r' ? end - 1 : end });
		if (nl === -1) return spans;
		from = nl + 1;
	}
}

/** Index of the `]` closing the `[` at `open`, nested brackets and escapes allowed, or -1. */
function closingBracket(text: string, open: number, end = text.length): number {
	let depth = 0;
	for (let i = open; i < end; i++) {
		const c = text[i];
		if (c === '\\') i++;
		else if (c === '[') depth++;
		else if (c === ']' && --depth === 0) return i;
	}
	return -1;
}

/** `url` or `<url>`, then an optional `"title"`: the URL's span within `dest`. */
const DESTINATION = /^(\s*)(<[^>]*>|[^\s()<>]+)(?:\s+"[^"]*")?\s*$/;

interface Link {
	/** The `[`, or the `!` before it for media. */
	from: number;
	/** After the closing `)`. */
	to: number;
	textFrom: number;
	textTo: number;
	urlFrom: number;
	urlTo: number;
	image: boolean;
}

/** The `[text](url)` links (and `![…](…)` media) in `start`..`end`, outermost first. */
function linksIn(body: string, start: number, end: number): Link[] {
	const links: Link[] = [];
	for (let i = start; i < end; i++) {
		if (body[i] === '\\') {
			i++;
			continue;
		}
		if (body[i] !== '[') continue;
		const close = closingBracket(body, i, end);
		if (close === -1 || body[close + 1] !== '(') continue;
		const paren = body.indexOf(')', close + 2);
		if (paren === -1 || paren >= end) continue;
		const dest = DESTINATION.exec(body.slice(close + 2, paren));
		if (!dest) continue;
		const urlFrom = close + 2 + dest[1].length + (dest[2].startsWith('<') ? 1 : 0);
		const urlTo = urlFrom + dest[2].length - (dest[2].startsWith('<') ? 2 : 0);
		const image = body[i - 1] === '!';
		links.push({ from: image ? i - 1 : i, to: paren + 1, textFrom: i + 1, textTo: close, urlFrom, urlTo, image });
	}
	return links;
}

/** Lines that are a single `![caption](href)`, by kind as the renderer tells them apart. */
export function mediaLines(body: string): MediaLine[] {
	const out: MediaLine[] = [];
	for (const span of lineSpans(body)) {
		// Whitespace around the media is allowed; `from`..`to` cover just the `![…](…)`.
		const text = body.slice(span.from, span.to);
		const from = span.from + (text.length - text.trimStart().length);
		const to = span.to - (text.length - text.trimEnd().length);
		if (!body.startsWith('![', from)) continue;
		const link = linksIn(body, from, to)[0];
		if (!link || link.from !== from || link.to !== to) continue;
		const href = body.slice(link.urlFrom, link.urlTo);
		const kind = isMissingHref(href) ? 'missing' : href.includes('youtube.com') ? 'youtube' : href.trimEnd().endsWith('.mp4') ? 'video' : 'photo';
		out.push({ from, to, kind, caption: body.slice(link.textFrom, link.textTo), captionFrom: link.textFrom, captionTo: link.textTo, href });
	}
	return out;
}

/** The `[text](/404/)` links: places without a post yet. Missing media is `mediaLines`'. */
export function missingLinks(body: string): { from: number; to: number }[] {
	return lineSpans(body).flatMap(({ from, to }) =>
		linksIn(body, from, to)
			.filter((l) => !l.image && isMissingHref(body.slice(l.urlFrom, l.urlTo)))
			.map((l) => ({ from: l.from, to: l.to }))
	);
}

/**
 * Wraps the selection in `before`/`after` (`**`, `_`, `<span lang="de">`…`</span>`),
 * or unwraps it when it is already wrapped: markers inside the selection or
 * right around it. The inner text stays selected.
 */
export function wrap(sel: { body: string; from: number; to: number }, before: string, after: string): MdChange {
	const { body, from, to } = sel;
	const text = body.slice(from, to);
	// One wrapped run only: `_a_ and _b_` is two, so it gets wrapped, not unwrapped.
	const oneRun = (inner: string) => !inner.includes(before) && !inner.includes(after);
	if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
		const inner = text.slice(before.length, text.length - after.length);
		if (oneRun(inner)) return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
	}
	if (oneRun(text) && body.slice(from - before.length, from) === before && body.startsWith(after, to)) {
		const start = from - before.length;
		return { from: start, to: to + after.length, insert: text, selFrom: start, selTo: start + text.length };
	}
	return { from, to, insert: before + text + after, selFrom: from + before.length, selTo: from + before.length + text.length };
}

/**
 * Toggles a line prefix (`## `, `> `, `- `) on the given lines (each its start
 * offset and text, consecutive): removed when every non-blank line has it, else
 * added where missing. A heading prefix replaces another heading level. Blank
 * lines in a block stay blank, and the line breaks between the lines stay as
 * they are. One line leaves the cursor at its end; several stay selected.
 */
export function linePrefix(lines: { from: number; text: string }[], prefix: string): MdChange {
	const first = lines[0];
	const last = lines[lines.length - 1];
	const from = first.from;
	const to = last.from + last.text.length;
	const block = lines.length > 1;
	const filled = lines.filter((l) => l.text.trim() !== '');
	const remove = filled.length > 0 && filled.every((l) => l.text.startsWith(prefix));
	const heading = /^#+ $/.test(prefix);
	const changed = lines.map(({ text }) => {
		if (remove) return text.startsWith(prefix) ? text.slice(prefix.length) : text;
		if (text.startsWith(prefix) || (block && text.trim() === '')) return text;
		if (heading && /^#{1,6} /.test(text)) return text.replace(/^#{1,6} /, prefix);
		return prefix + text;
	});
	// The line break after each line is whatever lies between it and the next: `\n` or `\r\n`.
	const insert = changed.map((text, i) => {
		const next = lines[i + 1];
		return next ? text + (next.from - lines[i].from - lines[i].text.length === 2 ? '\r\n' : '\n') : text;
	}).join('');
	const end = from + insert.length;
	return { from, to, insert, selFrom: block ? from : end, selTo: end };
}

/**
 * Turns the link the selection is in, or reaches into from either side, into
 * a missing one (its URL becomes `/404/`, a title kept), or a plain selection
 * into `[selection](/404/)`. The link text ends up selected. Null (nothing to
 * do) for a cursor outside any link, a selection across a line break, one
 * whose ends are in two different links, or one holding a whole link.
 */
export function markMissing(body: string, sel: { from: number; to: number }): MdChange | null {
	if (body.slice(sel.from, sel.to).includes('\n')) return null;
	const line = lineSpans(body).find((l) => l.from <= sel.from && sel.from <= l.to);
	const links = line ? linksIn(body, line.from, line.to) : [];
	// Innermost first: links come outermost first, by where they start.
	const innermost = (test: (l: Link) => boolean) => links.filter(test).pop();
	let link = innermost((l) => l.from <= sel.from && sel.to <= l.to);
	if (!link) {
		const atFrom = innermost((l) => l.from < sel.from && sel.from < l.to);
		const atTo = innermost((l) => l.from < sel.to && sel.to < l.to);
		if (atFrom && atTo && atFrom !== atTo) return null;
		link = atFrom ?? atTo;
	}
	if (link) {
		// The text comes before the URL, so its offsets don't move.
		return { from: link.urlFrom, to: link.urlTo, insert: MISSING_HREF, selFrom: link.textFrom, selTo: link.textTo };
	}
	if (sel.from === sel.to || links.some((l) => sel.from <= l.from && l.to <= sel.to)) return null;
	const text = body.slice(sel.from, sel.to);
	return { from: sel.from, to: sel.to, insert: `[${text}](${MISSING_HREF})`, selFrom: sel.from + 1, selTo: sel.from + 1 + text.length };
}

const isBlank = (s: string) => s.trim() === '';

/**
 * `![caption](href)` on its own line at `pos`, with a blank line before and
 * after unless one is already there. Inside a word it goes after the word; in
 * the middle of a line the line is split there, without the spaces around the
 * split; at the start of a line, the line stays as it is below it. Line breaks
 * are the body's own, and a trailing one is kept. The caption ends up selected.
 */
export function mediaInsert(body: string, pos: number, caption: string, href: string): MdChange {
	const eol = lineEnding(body);
	const spans = lineSpans(body);
	const lineAt = spans.findIndex((l) => l.from <= pos && pos <= l.to);
	const line = spans[lineAt];
	let at = pos;
	while (at < line.to && /\S/.test(body[at]) && at > line.from && /\S/.test(body[at - 1])) at++;
	const head = body.slice(line.from, at);
	const rest = body.slice(at, line.to);
	const tail = rest.trimStart();
	const prev = spans[lineAt - 1];
	const next = spans[lineAt + 1];

	let from: number;
	let to: number;
	let prefix = '';
	let suffix = '';
	if (!isBlank(head)) {
		// Split the line, dropping the spaces on both sides of the split.
		from = line.from + head.trimEnd().length;
		to = at + rest.length - tail.length;
		prefix = eol + eol;
	} else {
		// Before the line, which stays as it is (indentation included); a
		// whitespace-only line is replaced.
		from = line.from;
		to = isBlank(rest) ? line.to : line.from;
		if (prev && !isBlank(body.slice(prev.from, prev.to))) prefix = eol;
	}
	if (!isBlank(head) && tail !== '') suffix = eol + eol;
	else if (isBlank(head) && !isBlank(rest)) suffix = eol + eol;
	else if (next && !isBlank(body.slice(next.from, next.to))) suffix = eol;
	// On the last line, after the body's final line break: keep one at the end.
	else if (!next && prev && isBlank(head) && isBlank(rest)) suffix = eol;
	const media = `![${caption}](${href})`;
	const selFrom = from + prefix.length + 2;
	return { from, to, insert: prefix + media + suffix, selFrom, selTo: selFrom + caption.length };
}

/** `[title](/hikes/<date>-<slug>/)` at `pos`, the title selected. */
export function hikeLinkInsert(pos: number, title: string, date: string, slug: string): MdChange {
	return { from: pos, to: pos, insert: `[${title}](/hikes/${date}-${slug}/)`, selFrom: pos + 1, selTo: pos + 1 + title.length };
}

/** The node's name and, when it has an `ele`, its height: `Name (ele m)`. */
export function mentionText(node: PlaceNode): string {
	const tags = node.tags ?? {};
	const name = [tags.name, tags['name:de'], tags['name:en']].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? '';
	const ele = nodeEle(node);
	return ele == null ? name : `${name} (${Math.round(ele)} m)`;
}

/** Replaces `from`..`to` (the typed letters) with the node's mention, the cursor after it. */
export function mentionInsert(from: number, to: number, node: PlaceNode): MdChange {
	const insert = mentionText(node);
	return { from, to, insert, selFrom: from + insert.length, selTo: from + insert.length };
}

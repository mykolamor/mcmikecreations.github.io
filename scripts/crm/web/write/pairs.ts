/**
 * The Write tab's side by side view, free of the DOM: a body cut into blocks (paragraphs, headings, media lines,
 * separated by blank lines), the English blocks paired with the translation's, and a block's edit applied to the
 * current body by the block's own text, never at an offset that may have gone stale (the IDE, another tab or an
 * upload's credit changed the body meanwhile).
 */
import { lineEnding, mediaLines } from '../../shared/md-lines';
import { isBody, type createDocSession } from '../doc-session';

type Session = ReturnType<typeof createDocSession>;

export type Block = {
	kind: 'media' | 'heading' | 'text';
	/** The block as written, without the line break after it. */
	text: string;
	from: number;
	to: number;
	/** A media block's first href. */
	anchor?: string;
};
export type Pair = { en?: Block; tr?: Block };

const isBlank = (line: string) => /^[ \t\r]*$/.test(line);
const HEADING = /^ {0,3}#{1,6}(\s|$)/;

/** The body's blocks, in order: one or more blank lines separate two. */
export function blocks(body: string): Block[] {
	const out: Block[] = [];
	let start = -1;
	let end = 0;
	let lines = 0;
	const close = () => {
		if (start < 0) return;
		const text = body.slice(start, end);
		const media = mediaLines(text);
		const block: Block = { kind: 'text', text, from: start, to: end };
		if (media.length === lines) {
			block.kind = 'media';
			block.anchor = media[0].href.trim();
		} else if (lines === 1 && HEADING.test(text)) block.kind = 'heading';
		out.push(block);
		start = -1;
	};
	let from = 0;
	for (;;) {
		const nl = body.indexOf('\n', from);
		const lineEnd = nl === -1 ? body.length : nl;
		const to = lineEnd > from && body[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
		if (isBlank(body.slice(from, lineEnd))) close();
		else {
			if (start < 0) {
				start = from;
				lines = 0;
			}
			lines++;
			end = to;
		}
		if (nl === -1) break;
		from = nl + 1;
	}
	close();
	return out;
}

/** What pairs a block with the other language's regardless of order: a media block's href set, a heading's rank. */
function anchorKeys(list: Block[]): (string | null)[] {
	const seen = new Map<string, number>();
	let headings = 0;
	return list.map((b) => {
		let key: string;
		if (b.kind === 'heading') key = `h${headings++}`;
		else if (b.kind === 'media') key = `m${[...new Set(mediaLines(b.text).map((m) => m.href.trim()))].sort().join('\n')}`;
		else return null;
		// The same photo set twice pairs first with first.
		const n = seen.get(key) ?? 0;
		seen.set(key, n + 1);
		return `${key}#${n}`;
	});
}

/** The anchors both sides have, in an order both keep (the longest such run), as index pairs. */
function anchorPairs(en: Block[], tr: Block[]): [number, number][] {
	const a = anchorKeys(en);
	const b = anchorKeys(tr);
	// lcs[i][j]: the longest common run of a[i..] and b[j..]
	const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lcs[i][j] = a[i] !== null && a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const out: [number, number][] = [];
	for (let i = 0, j = 0; i < a.length && j < b.length; ) {
		if (a[i] !== null && a[i] === b[j]) out.push([i++, j++]);
		else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
		else j++;
	}
	return out;
}

/**
 * The English blocks beside the translation's: media by their href set and headings by their order pair first; the
 * text blocks between two such pairs pair by order, the extras on either side with an empty partner. The pairs follow
 * the English order; a block only the translation has sits where it is in the translation.
 */
export function pairBlocks(en: Block[], tr: Block[]): Pair[] {
	const out: Pair[] = [];
	const anchors = anchorPairs(en, tr);
	let i = 0;
	let j = 0;
	for (const [ai, aj] of [...anchors, [en.length, tr.length] as [number, number]]) {
		const enText = en.slice(i, ai).filter((b) => b.kind === 'text');
		const trIdx = [...tr.keys()].slice(j, aj);
		const trText = trIdx.filter((k) => tr[k].kind === 'text');
		const partner = new Map(enText.slice(0, trText.length).map((b, n) => [b, trText[n]]));
		const paired = new Set(partner.values());
		const seg: { pair: Pair; at: number | null }[] = en.slice(i, ai).map((b) => {
			const k = partner.get(b);
			return k === undefined ? { pair: { en: b }, at: null } : { pair: { en: b, tr: tr[k] }, at: k };
		});
		for (const k of trIdx) {
			if (paired.has(k)) continue;
			const before = seg.findIndex((s) => s.at !== null && s.at > k);
			seg.splice(before < 0 ? seg.length : before, 0, { pair: { tr: tr[k] }, at: k });
		}
		out.push(...seg.map((s) => s.pair));
		if (ai < en.length) out.push({ en: en[ai], tr: tr[aj] });
		i = ai + 1;
		j = aj + 1;
	}
	return out;
}

/** `at` starts a block: the body's start, or a line after a blank one. */
function atBlockStart(body: string, at: number): boolean {
	if (at === 0) return true;
	if (body[at - 1] !== '\n') return false;
	return isBlank(body.slice(body.lastIndexOf('\n', at - 2) + 1, at - 1));
}

/** `at` ends a block: the body's end, or a line break before a blank line or the end. */
const atBlockEnd = (body: string, at: number) => at === body.length || /^\r?\n[ \t\r]*(\n|$)/.test(body.slice(at));

/** Where `block` is in `body` now: at its own offset, else where its text alone makes up a block once; else null. */
function locate(body: string, block: Block): number | null {
	const whole = (at: number) => body.startsWith(block.text, at) && atBlockStart(body, at) && atBlockEnd(body, at + block.text.length);
	if (whole(block.from)) return block.from;
	let found: number | null = null;
	for (let at = body.indexOf(block.text); at !== -1; at = body.indexOf(block.text, at + 1)) {
		if (!whole(at)) continue;
		if (found !== null) return null;
		found = at;
	}
	return found;
}

/** A textarea's text with the body's own line breaks. */
const withEol = (body: string, text: string) => text.replace(/\r?\n/g, lineEnding(body));

/**
 * `body` with `block` replaced by `text`, found as `locate` finds it; null when it can't be (a conflict). An empty
 * `text` removes the block and the blank line that separated it.
 */
export function replaceBlock(body: string, block: Block, text: string): string | null {
	const at = locate(body, block);
	if (at === null) return null;
	const end = at + block.text.length;
	if (text !== '') return body.slice(0, at) + withEol(body, text) + body.slice(end);
	const after = /^\r?\n[ \t\r]*\n/.exec(body.slice(end));
	if (after) return body.slice(0, at) + body.slice(end + after[0].length);
	const before = /\r?\n[ \t\r]*\r?\n$/.exec(body.slice(0, at));
	if (before) return body.slice(0, at - before[0].length) + body.slice(end);
	return body.slice(0, at) + body.slice(end);
}

/**
 * `body` with `text` as a new block after `after` (found as `locate` finds it), or at the start, blank lines around
 * it; null when `after` can't be found (a conflict).
 */
export function insertBlock(body: string, after: Block | null, text: string): string | null {
	const eol = lineEnding(body);
	const t = withEol(body, text);
	if (!after) return body.trim() === '' ? t + eol : t + eol + eol + body;
	const at = locate(body, after);
	if (at === null) return null;
	const end = at + after.text.length;
	return body.slice(0, end) + eol + eol + t + body.slice(end);
}

/** The session's body as its next save will leave it: queued, else being sent, else the doc's; null without a body. */
export function currentBody(session: Session): string | null {
	const sending = session.queue.inFlight().find(isBody)?.text;
	const body = session.unsavedBody() ?? sending ?? session.doc?.body;
	return typeof body === 'string' ? body : null;
}

/** A textarea's text as a block: no line breaks after it, and none at all when it is blank. */
const blockText = (text: string) => (text.trim() === '' ? '' : text.replace(/(\r?\n[ \t]*)+$/, ''));

/** Raises the session's conflict, unless one is open already: its doc (a 409's, newer than mine) stays. */
function conflict(session: Session) {
	if (session.queue.status !== 'conflict') session.queue.markConflict(session.doc);
}

/**
 * Types `text` into `block` of the session's current body: queues the body (debounced, as the editor's) and returns the
 * block as it now is (its text empty once removed). A block that can't be found raises the session's conflict, and
 * nothing is queued: null.
 */
export function editBlock(session: Session, block: Block, typed: string): Block | null {
	const body = currentBody(session);
	if (body === null) return null;
	const text = blockText(typed);
	const at = locate(body, block);
	const next = at === null ? null : replaceBlock(body, { ...block, from: at }, text);
	if (at === null || next === null) {
		conflict(session);
		return null;
	}
	session.edit({ kind: 'body', text: next }, true);
	const t = withEol(body, text);
	return { ...block, text: t, from: at, to: at + t.length };
}

/** Types `text` as a new block after `after` (or at the start), as `editBlock`: the new block, or null on a conflict. */
export function addBlock(session: Session, after: Block | null, typed: string): Block | null {
	const body = currentBody(session);
	const text = blockText(typed);
	if (body === null || text === '') return null;
	const next = insertBlock(body, after, text);
	if (next === null) {
		conflict(session);
		return null;
	}
	session.edit({ kind: 'body', text: next }, true);
	const t = withEol(body, text);
	const from = after ? next.indexOf(t, locate(body, after)! + after.text.length) : 0;
	return { kind: 'text', text: t, from, to: from + t.length };
}


/**
 * Typing into one side of a row, as long as its textarea has the focus: each input edits the block it typed so far
 * (found again by its text in the current body, so a reload or a save meanwhile is no matter), or, for an empty side,
 * adds one after `after`. Each input is either queued or a conflict (raised, or already open); blank text into an
 * empty side adds nothing.
 */
export function blockTyping(session: Session, block: Block | null, after: Block | null) {
	let cur = block;
	return {
		input(text: string): 'queued' | 'conflict' | 'empty' {
			if (cur) {
				const next = editBlock(session, cur, text);
				if (!next) return 'conflict';
				cur = next.text === '' ? null : next;
				return 'queued';
			}
			if (blockText(text) === '') return 'empty';
			const next = addBlock(session, after, text);
			if (!next) return 'conflict';
			cur = next;
			return 'queued';
		}
	};
}

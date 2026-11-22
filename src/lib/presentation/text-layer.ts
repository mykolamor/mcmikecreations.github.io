/** A rectangle in slide pixels (the 1600×900 space). */
export interface Box { x: number; y: number; w: number; h: number; }
/** One line of visible text and its box, in slide pixels. */
export interface TextRun extends Box { text: string; }
/** A word of a text node: `[start, end)` into the node's text and its box. */
export interface Word extends Box { start: number; end: number; }

export const SLIDE_W = 1600;
export const SLIDE_H = 900;

/**
 * Groups one text node's words into lines: a word continues the current line when it overlaps it
 * vertically by at least half its height and doesn't start left of the line's end (a wrap goes back left).
 */
export function groupLines(text: string, words: Word[]): TextRun[] {
	const runs: TextRun[] = [];
	let line: (Box & { start: number; end: number }) | null = null;
	const flush = () => {
		if (!line) return;
		const t = text.slice(line.start, line.end).replace(/\s+/g, ' ').trim();
		if (t) runs.push({ text: t, x: line.x, y: line.y, w: line.w, h: line.h });
		line = null;
	};
	for (const w of words) {
		if (w.w <= 0 || w.h <= 0) continue;
		if (line) {
			const l: Box & { start: number; end: number } = line;
			const overlap = Math.min(l.y + l.h, w.y + w.h) - Math.max(l.y, w.y);
			if (overlap >= Math.min(l.h, w.h) / 2 && w.x >= l.x + l.w - 1) {
				const right = Math.max(l.x + l.w, w.x + w.w);
				const bottom = Math.max(l.y + l.h, w.y + w.h);
				l.y = Math.min(l.y, w.y);
				l.w = right - l.x;
				l.h = bottom - l.y;
				l.end = w.end;
				continue;
			}
			flush();
		}
		line = { x: w.x, y: w.y, w: w.w, h: w.h, start: w.start, end: w.end };
	}
	flush();
	return runs;
}

/** Roboto's ascent + descent (hhea, 1900 + 500 over 2048 units/em): an em is a text box's height over this. */
const LINE_EM = 2400 / 2048;
/** Roboto's ascent over its ascent + descent: where the baseline sits within the text box. */
const BASELINE = 1900 / 2400;

/**
 * Where to draw a run as invisible PDF text so its glyphs cover the run's box: font size (pt), baseline
 * position (pt) and the horizontal scale (1 = 100%) that stretches the measured width onto the box.
 * `k` is points per slide pixel; `widthAt1pt` is the text's width in points at a 1 pt font size.
 */
export function fitRun(run: TextRun, k: number, widthAt1pt: number): { size: number; x: number; y: number; scale: number } {
	const size = (run.h * k) / LINE_EM;
	const natural = widthAt1pt * size;
	return { size, x: run.x * k, y: (run.y + run.h * BASELINE) * k, scale: natural > 0 ? (run.w * k) / natural : 1 };
}

/**
 * The visible text of a mounted slide, line by line, in slide pixels. Skips text that is hidden
 * (`display: none`, `visibility`, near-zero opacity below `root`) or outside the slide. `root`'s own
 * opacity is ignored: the export mounts it transparent.
 */
export function textRuns(root: HTMLElement): TextRun[] {
	const rootBox = root.getBoundingClientRect();
	if (rootBox.width === 0 || rootBox.height === 0) return [];
	const sx = SLIDE_W / rootBox.width;
	const sy = SLIDE_H / rootBox.height;
	const shown = new Map<Element, boolean>();
	const visible = (el: Element): boolean => {
		const known = shown.get(el);
		if (known !== undefined) return known;
		const cs = getComputedStyle(el);
		let v = cs.display !== 'none' && Number(cs.opacity) > 0.05;
		if (v && el.parentElement && el.parentElement !== root) v = visible(el.parentElement);
		shown.set(el, v);
		return v;
	};

	const runs: TextRun[] = [];
	const range = document.createRange();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const node = n as Text;
		const parent = node.parentElement;
		if (!parent || !/\S/.test(node.data) || parent.closest('style, script, template, title, desc')) continue;
		if (getComputedStyle(parent).visibility !== 'visible' || !visible(parent)) continue;
		const words: Word[] = [];
		for (const m of node.data.matchAll(/\S+/g)) {
			const start = m.index;
			const end = start + m[0].length;
			range.setStart(node, start);
			range.setEnd(node, end);
			const r = range.getBoundingClientRect();
			words.push({ start, end, x: (r.left - rootBox.left) * sx, y: (r.top - rootBox.top) * sy, w: r.width * sx, h: r.height * sy });
		}
		for (const run of groupLines(node.data, words)) {
			if (run.x + run.w <= 0 || run.y + run.h <= 0 || run.x >= SLIDE_W || run.y >= SLIDE_H) continue;
			runs.push(run);
		}
	}
	range.detach();
	return runs;
}

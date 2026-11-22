// Client-side PDF export of a deck: one page per state. Each page is a screenshot of the state (exactly what
// the frame shows, SVG and CSS variables included) with the state's text laid over it as invisible text,
// so the PDF can be searched and its text selected and copied. Loaded on demand (jsPDF, modern-screenshot).
import { jsPDF } from 'jspdf';
import { createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import fontUrl from './fonts/roboto-text-layer.ttf?url';
import type { DomSlideHost } from './slide-host';
import { fitRun, SLIDE_H, SLIDE_W, textRuns } from './text-layer';
import type { NormalizedPresentation } from './types';

/** A page in points: 1600×900 CSS px at 96 dpi. */
const PAGE_W = SLIDE_W * 0.75;
const PAGE_H = SLIDE_H * 0.75;
/** Device pixels per slide pixel in the screenshots. */
const SCALE = 2;
const JPEG_QUALITY = 0.9;
const FONT = 'pres-text-layer';

export interface ExportOptions {
	presentation: NormalizedPresentation;
	host: DomSlideHost;
	/** The page colour behind the slides (the frame's `--pres-bg`, resolved). */
	background: string;
	filename: string;
	onProgress?(done: number, total: number): void;
	signal?: AbortSignal;
}

/** Resolves once `el`'s subtree has gone `quietMs` without a DOM change, or after `maxMs`. */
function settle(el: Element, quietMs: number, maxMs: number): Promise<void> {
	return new Promise((resolve) => {
		let timer = 0;
		const done = () => {
			observer.disconnect();
			clearTimeout(timer);
			clearTimeout(cap);
			resolve();
		};
		const observer = new MutationObserver(() => {
			clearTimeout(timer);
			timer = window.setTimeout(done, quietMs);
		});
		observer.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
		timer = window.setTimeout(done, quietMs);
		const cap = window.setTimeout(done, maxMs);
	});
}

/** Marks elements whose width the slide never set (no inline width) so the clone can unpin it. */
const AUTO_WIDTH = 'data-pdf-auto-width';
/** Replaced elements keep their pinned size: their auto width is intrinsic, not their content's. */
const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'INPUT', 'TEXTAREA', 'SELECT']);

/**
 * modern-screenshot pins every element's computed width in px. The screenshot (an SVG image) can measure
 * text a fraction of a pixel wider than the page did, and a shrink-to-fit box pinned to its old width then
 * wraps (a chart legend drops its last item onto the note below). Elements the slide left at an auto
 * width are marked here and get their width unpinned in the clone, so they size to their content again.
 * Returns the cleanup that removes the marks.
 */
function markAutoWidths(root: HTMLElement): () => void {
	const marked: Element[] = [];
	for (const el of root.querySelectorAll('*')) {
		if (!(el instanceof HTMLElement) || REPLACED.has(el.tagName) || el.style.width || el.style.inlineSize) continue;
		el.setAttribute(AUTO_WIDTH, '');
		marked.push(el);
	}
	return () => { for (const el of marked) el.removeAttribute(AUTO_WIDTH); };
}

function unpinAutoWidth(node: Node): void {
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const el = node as HTMLElement;
	if (!el.hasAttribute(AUTO_WIDTH)) return;
	el.removeAttribute(AUTO_WIDTH);
	el.style.removeProperty('width');
	el.style.removeProperty('inline-size');
}

const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function fontBase64(): Promise<string> {
	const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

/** Renders every state of the deck and downloads the PDF. Rejects with an `AbortError` when `signal` aborts. */
export async function exportPdf(o: ExportOptions): Promise<void> {
	const { presentation: p, host, signal } = o;
	const total = p.slides.reduce((n, s) => n + s.states.length, 0);
	const doc = new jsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H], orientation: 'landscape', compress: true });
	doc.addFileToVFS(`${FONT}.ttf`, await fontBase64());
	doc.addFont(`${FONT}.ttf`, FONT, 'normal', 'normal', 'Identity-H');
	doc.setFont(FONT, 'normal');
	await document.fonts.ready;

	let done = 0;
	o.onProgress?.(done, total);
	for (let slide = 0; slide < p.slides.length; slide++) {
		signal?.throwIfAborted();
		let shot: Awaited<ReturnType<typeof createContext<HTMLElement>>> | null = null;
		try {
			await host.captureStates(slide, async (root, state) => {
				signal?.throwIfAborted();
				// The first state waits for what the slide loads on mount (fetched SVGs, images).
				if (state === 0) await settle(root, 300, 5000);
				await frames();
				await settle(root, 50, 1000);
				shot ??= await createContext(root, {
					width: SLIDE_W,
					height: SLIDE_H,
					scale: SCALE,
					backgroundColor: o.background,
					// The capture root is mounted transparent; only the clone is made opaque.
					style: { opacity: '1' },
					type: 'image/jpeg',
					quality: JPEG_QUALITY,
					onCloneEachNode: unpinAutoWidth
				});
				const unmark = markAutoWidths(root);
				let canvas: HTMLCanvasElement;
				try {
					canvas = await domToCanvas(shot);
				} finally {
					unmark();
				}
				const runs = textRuns(root);

				if (done > 0) doc.addPage([PAGE_W, PAGE_H], 'landscape');
				doc.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'NONE');
				for (const run of runs) {
					doc.setFontSize(1);
					const fit = fitRun(run, PAGE_W / SLIDE_W, doc.getTextWidth(run.text));
					doc.setFontSize(fit.size);
					doc.text(run.text, fit.x, fit.y, { renderingMode: 'invisible', horizontalScale: fit.scale });
				}
				o.onProgress?.(++done, total);
			});
		} finally {
			if (shot) destroyContext(shot);
		}
	}
	signal?.throwIfAborted();
	doc.save(o.filename);
}

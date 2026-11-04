/**
 * How photo pins look and behave: the one module a restyle replaces (dots
 * today; labels or a peak-finder row later). The data side is
 * `photo-pins.ts`; the renderer and the gallery only call what's here.
 *
 * Pins are progressive: `photoPinsHtml` is part of the server-rendered (and
 * client re-parsed) figure, hidden until `attachPhotoPins` wires the page, so
 * without scripts a photo looks as it always has.
 */

import { nodePopupHtml, nodeTitle } from '$lib/hikes/map-utils';
import type { PhotoPin, PinNode } from '$lib/hikes/photo-pins';
import { t, tHtml } from '$lib/i18n/strings';
import type { Lang } from '$lib/i18n/languages';

const escapeAttr = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const percent = (fraction: number) => `${+(fraction * 100).toFixed(2)}%`;

/** "Zugspitze, 2962 m": what a pin is called for screen readers and on hover. */
function pinLabel(node: PinNode, lang: Lang): string {
	const ele = node.tags.ele ? `, ${t(lang, 'units.m', { value: node.tags.ele.replace(/\s*m$/, '') })}` : '';
	return `${nodeTitle(node.tags, lang)}${ele}`;
}

/**
 * A photo's pin layer: one button per pin whose element is in `nodes`,
 * placed by percentages so it lands on the same spot at any size. Empty when
 * there is nothing to draw.
 */
export function photoPinsHtml(pins: PhotoPin[] | undefined, nodes: Record<string, PinNode> | undefined, lang: Lang = 'en'): string {
	const buttons = (pins ?? []).flatMap((pin) => {
		const node = nodes?.[pin.ref];
		if (!node) return [];
		const label = escapeAttr(pinLabel(node, lang));
		return [
			`<button type="button" class="mk-photo-pin" data-pin-ref="${pin.ref}" style="left:${percent(pin.x)};top:${percent(pin.y)}" aria-label="${label}"></button>`
		];
	});
	return buttons.length ? `<span class="mk-photo-pins">${buttons.join('')}</span>` : '';
}

/** Styles for pins and their popup, added to the post's style block. */
export const photoPinsCss = `
.mk-photo-pins { display: none; position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.mk-photo-pins-ready .mk-photo-pins { display: block; }
.mk-photo-pin { position: absolute; width: 14px; height: 14px; padding: 0; margin: 0; transform: translate(-50%, -50%); border-radius: 9999px; background: #fff; border: 3px solid var(--color-primary-600, #0d9488); box-shadow: 0 1px 4px rgb(0 0 0 / 0.5); cursor: pointer; pointer-events: auto; }
.mk-photo-pin::before { content: ""; position: absolute; inset: -10px; border-radius: 9999px; }
.mk-photo-pin:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.mk-photo-pin[aria-expanded="true"] { background: var(--color-primary-600, #0d9488); }
.mk-photo-pin-popup { position: absolute; z-index: 2; width: max-content; max-width: min(260px, calc(100% - 16px)); padding: 8px 10px; border-radius: 6px; background: #fff; color: rgb(17 24 39); font-size: 13px; line-height: 1.4; text-align: left; box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); pointer-events: auto; cursor: auto; }
.dark .mk-photo-pin-popup { background: rgb(31 41 55); color: rgb(243 244 246); }
.mk-photo-pin-map { margin-top: 6px; padding: 3px 10px; border: 1px solid var(--color-primary-600, #0d9488); border-radius: 4px; background: none; color: var(--color-primary-600, #0d9488); font: inherit; font-weight: 600; cursor: pointer; }
.mk-photo-pin-map:hover, .mk-photo-pin-map:focus-visible { background: var(--color-primary-600, #0d9488); color: #fff; }
`;

export interface AttachPhotoPinsOptions {
	/** "Show on map": bring the post's 2D map into view, focused on the place. */
	onShowOnMap(lat: number, lon: number): void;
	/** Aborting removes every listener this added. */
	signal: AbortSignal;
	/** The popup's language. */
	lang?: Lang;
}

/**
 * Show the pins under `root` and give them their popup: on hover with a
 * mouse, on tap or Enter otherwise; closed by leaving the photo, clicking
 * elsewhere or Escape. The popup is the 2D map's node popup plus a
 * "Show on map" button.
 */
export function attachPhotoPins(root: HTMLElement, nodes: Record<string, PinNode>, { onShowOnMap, signal, lang = 'en' }: AttachPhotoPinsOptions): void {
	root.classList.add('mk-photo-pins-ready');
	signal.addEventListener('abort', () => root.classList.remove('mk-photo-pins-ready'));

	let open: { pin: HTMLElement; popup: HTMLElement } | null = null;
	const close = () => {
		if (!open) return;
		open.pin.setAttribute('aria-expanded', 'false');
		open.popup.remove();
		open = null;
	};
	const show = (pin: HTMLElement) => {
		if (open?.pin === pin) return;
		close();
		const node = nodes[pin.dataset.pinRef ?? ''];
		const layer = pin.parentElement;
		if (!node || !layer) return;
		const popup = document.createElement('div');
		popup.className = 'mk-photo-pin-popup';
		popup.setAttribute('role', 'dialog');
		popup.setAttribute('aria-label', pinLabel(node, lang));
		popup.innerHTML = nodePopupHtml(node.tags, '', lang) + `<button type="button" class="mk-photo-pin-map">${tHtml(lang, 'map.showOnMap')}</button>`;
		const x = parseFloat(pin.style.left) / 100;
		const y = parseFloat(pin.style.top) / 100;
		// Open away from the nearest edges, so the popup stays on the photo.
		const dx = x < 0.3 ? '-14px' : x > 0.7 ? 'calc(-100% + 14px)' : '-50%';
		const dy = y > 0.5 ? 'calc(-100% - 14px)' : '14px';
		popup.style.left = pin.style.left;
		popup.style.top = pin.style.top;
		popup.style.transform = `translate(${dx}, ${dy})`;
		popup.querySelector('.mk-photo-pin-map')!.addEventListener('click', (event) => {
			event.stopPropagation();
			close();
			onShowOnMap(node.lat, node.lon);
		});
		popup.addEventListener('click', (event) => event.stopPropagation());
		layer.appendChild(popup);
		pin.setAttribute('aria-expanded', 'true');
		open = { pin, popup };
	};

	const pinOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.mk-photo-pin') : null);
	root.addEventListener(
		'click',
		(event) => {
			const pin = pinOf(event.target);
			if (!pin || !root.contains(pin)) return;
			// The photo under the pin opens the gallery; the pin must not.
			event.preventDefault();
			event.stopPropagation();
			if (open?.pin === pin && (event as PointerEvent).pointerType !== 'mouse') close();
			else show(pin);
		},
		{ signal }
	);
	root.addEventListener(
		'pointerover',
		(event) => {
			const pin = pinOf(event.target);
			if (pin && event.pointerType === 'mouse') show(pin);
		},
		{ signal }
	);
	root.addEventListener(
		'pointerout',
		(event) => {
			if (!open || event.pointerType !== 'mouse') return;
			const layer = open.pin.parentElement!;
			const shell = layer.parentElement ?? layer;
			if (!(event.relatedTarget instanceof Node) || !shell.contains(event.relatedTarget)) close();
		},
		{ signal }
	);
	document.addEventListener(
		'click',
		(event) => {
			if (open && !open.popup.contains(event.target as Node) && !open.pin.contains(event.target as Node)) close();
		},
		{ signal }
	);
	document.addEventListener(
		'keydown',
		(event) => {
			if (event.key !== 'Escape' || !open) return;
			const pin = open.pin;
			close();
			pin.focus();
		},
		{ signal }
	);
	signal.addEventListener('abort', close);
}

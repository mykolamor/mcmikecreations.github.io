// Deck runner: a slide is a build function over the kit's builder; snap() applies a state, step() animates
// the parts whose props differ between two states in one anime.js timeline, so ← mid-step reverses it.
// The slide root maps the figure colour tokens (--fig-*) to the deck frame's (--fig-*).
import { createTimeline } from 'animejs';
import { h } from './dom.js';
import { createRecord, builder, paint, apply } from './kit.js';
import { PRES_VARS } from './palette.js';

/** @typedef {import('../../../../src/lib/presentation/types').SlideContext} SlideContext */
/** @typedef {import('../../../../src/lib/presentation/types').SlideDef} SlideDef */
/** @typedef {import('../../../../src/lib/presentation/types').StepHandle} StepHandle */
/** @typedef {import('./text.js').Localized} Localized */
/** @typedef {import('./kit.js').FigRecord} Mount */
/** @typedef {import('./kit.js').Kit} Builder */
/** @typedef {import('animejs').Timeline} Timeline */

/** Slide size in px; ctx.root is this big before scaling. */
export const W = 1600;
export const H = 900;

const FIG_VARS = Object.entries(PRES_VARS).map(([k, v]) => `${k}:${v};`).join('');

/** paint() plus the slide title, kept on one line in every language by shrinking long (often German) titles. @param {SlideContext} ctx @param {Mount} m */
function paintSlide(ctx, m) {
	paint(m, ctx.lang);
	if (m.title) {
		// Keep the title on one line in every language: shrink long (often German) titles by length.
		const len = m.title.textContent?.length ?? 0;
		m.title.style.fontSize = `${Math.min(54, Math.floor(1440 / (len * 0.55)))}px`;
	}
}

/**
 * Step handle over a timeline; reverse() flips the same timeline and hands back the mirrored handle.
 * @param {Mount} m @param {Timeline} tl @param {number} target @param {number} origin @returns {StepHandle}
 */
function handleFor(m, tl, target, origin) {
	m.state = target;
	return {
		finish: () => { tl.complete(); },
		finished: tl.then(),
		reverse: () => {
			if (tl.reversed) tl.play();
			else tl.reverse();
			return handleFor(m, tl, origin, target);
		}
	};
}

/**
 * Builds a timeline animating every part from its props at `from` to its props at `to`.
 * Disappearing parts go first, moving parts next, appearing parts last (staggered).
 * @param {Mount} m @param {number} from @param {number} to @returns {Timeline | null}
 */
function timeline(m, from, to) {
	const tl = createTimeline({ autoplay: true, defaults: { ease: 'inOutCubic' } });
	let added = 0;
	let nIn = 0;
	let nOut = 0;
	let nMove = 0;
	for (const p of m.parts) {
		const a = p.at(from);
		const z = p.at(to);
		/** @type {Record<string, [number, number]>} */
		const props = {};
		for (const k of Object.keys(z)) {
			const av = a[k] ?? z[k];
			if (av !== z[k]) props[k] = [av, z[k]];
		}
		const keys = Object.keys(props);
		if (!keys.length) continue;
		const ao = a.opacity ?? 1;
		const zo = z.opacity ?? 1;
		const appears = zo > ao && ao === 0;
		const disappears = zo < ao && zo === 0;
		let delay = p.delay?.(from, to);
		if (delay === undefined) {
			if (disappears) delay = Math.min(nOut++ * 25, 250);
			else if (appears) delay = 250 + Math.min(nIn++ * 90, 900);
			else delay = 120 + Math.min(nMove++ * 20, 500);
		}
		const duration = p.duration ?? (disappears ? 350 : appears ? 550 : 800);
		tl.add(p.el, { ...props, duration, ease: p.ease ?? (appears ? 'outCubic' : 'inOutCubic') }, delay);
		added++;
	}
	if (!added) {
		tl.cancel();
		return null;
	}
	return tl;
}

/**
 * Defines a slide from a build function. build(b, root, ctx) creates the DOM in `root` and registers
 * parts and texts through `b`. It runs once per mount and must be deterministic (grid thumbnails
 * mount the same slide many times).
 * @param {{ name: string, label: Localized, states: { name: string, label: Localized }[], title?: Localized, build: (b: Builder, root: HTMLElement, ctx: SlideContext) => void }} def
 * @returns {SlideDef}
 */
export function slide(def) {
	/** @type {WeakMap<SlideContext, Mount>} */
	const mounts = new WeakMap();
	return {
		name: def.name,
		label: def.label,
		states: def.states,

		mount(ctx) {
			/** @type {Mount} */
			const m = createRecord();
			const b = builder(m);
			const root = h('div', `position:absolute;inset:0;${FIG_VARS}color:var(--fig-fg);background:var(--fig-bg);font-size:32px;line-height:1.3;`);
			if (def.title) {
				m.title = b.text('h2', 'position:absolute;left:80px;top:44px;right:80px;margin:0;font-size:54px;line-height:1.12;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;', def.title);
				root.append(m.title);
			}
			def.build(b, root, ctx);
			ctx.root.append(root);
			mounts.set(ctx, m);
			paintSlide(ctx, m);
		},

		snap(ctx, state) {
			const m = mounts.get(ctx);
			if (m) apply(m, state);
		},

		step(ctx, from, to) {
			const m = mounts.get(ctx);
			if (!m) return;
			apply(m, from);
			const tl = timeline(m, from, to);
			m.state = to;
			if (!tl) {
				apply(m, to);
				return;
			}
			m.tl = tl;
			return handleFor(m, tl, to, from);
		},

		finish(ctx) {
			mounts.get(ctx)?.tl?.complete();
		},

		update(ctx) {
			const m = mounts.get(ctx);
			if (m) paintSlide(ctx, m);
		},

		unmount(ctx) {
			mounts.get(ctx)?.tl?.cancel();
			mounts.delete(ctx);
		}
	};
}

/**
 * A bullet list; item k (with its sub-bullets) is shown from state `at`.
 * @param {Builder} b
 * @param {{ at: number, until?: number, text: Localized, sub?: Localized[] }[]} items
 * @param {{ size?: number, gap?: number, subSize?: number }} [o]
 */
export function bullets(b, items, o = {}) {
	const size = o.size ?? 32;
	const subSize = o.subSize ?? Math.round(size * 0.84);
	const ul = h('ul', `list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${o.gap ?? 22}px;`);
	for (const it of items) {
		const li = h('li', `display:flex;gap:18px;font-size:${size}px;line-height:1.28;`);
		const dot = h('span', `flex:none;width:${Math.round(size * 0.34)}px;height:${Math.round(size * 0.34)}px;margin-top:${Math.round(size * 0.47)}px;border-radius:50%;background:var(--fig-accent);`);
		const body = h('div', 'display:flex;flex-direction:column;gap:6px;min-width:0;');
		body.append(b.text('div', 'white-space:pre-line;', it.text));
		if (it.sub?.length) {
			const sub = h('ul', `list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:${subSize}px;color:var(--fig-fg);`);
			for (const s of it.sub) {
				const sl = h('li', 'display:flex;gap:14px;');
				sl.append(h('span', 'flex:none;color:var(--fig-muted);', '–'), b.text('span', 'white-space:pre-line;', s));
				sub.append(sl);
			}
			body.append(sub);
		}
		li.append(dot, body);
		b.show(li, it.at, it.until);
		ul.append(li);
	}
	return ul;
}

/**
 * A figure from the paper (converted from its PDF to SVG) on a light card, so it reads in both themes.
 * The text inside the figure is the paper's (English); only the alt text is localized.
 * @param {Builder} b @param {string | URL} src image URL (resolve it against the deck's own import.meta.url) @param {string} css position/size of the card @param {Localized} alt
 */
export function figure(b, src, css, alt) {
	const card = h('div', `position:absolute;box-sizing:border-box;padding:14px;border-radius:14px;background:#fff;border:1px solid var(--fig-dim);display:flex;align-items:center;justify-content:center;${css}`);
	const img = /** @type {HTMLImageElement} */ (h('img', 'width:100%;height:100%;object-fit:contain;display:block;'));
	img.src = String(src);
	b.attr(img, 'alt', alt);
	img.decoding = 'async';
	img.draggable = false;
	card.append(img);
	return card;
}

// Slide 2: a hand-written SVG (../diagram.svg), fetched and inlined on mount. Six boxes (stand-ins for
// logos) sit in a pool; each state reveals a category and its boxes fly to it with an anime.js timeline.
// The step handle's reverse() reverses that timeline in place.
import { createTimeline, utils } from 'animejs';

/** @typedef {import('../../../../../../src/lib/presentation/types').SlideContext} SlideContext */
/** @typedef {import('../../../../../../src/lib/presentation/types').SlideDef} SlideDef */
/** @typedef {import('../../../../../../src/lib/presentation/types').StepHandle} StepHandle */
/** @typedef {import('animejs').Timeline} Timeline */

const SVG_URL = new URL('../diagram.svg', import.meta.url);

/** Categories in reveal order: state k (k ≥ 1) reveals CATS[k - 1]. */
const CATS = ['restarts', 'replicas'];

const TEXT = {
	title: {
		en: 'Which databases fit which need?',
		de: 'Welche Datenbank passt zu welchem Bedarf?',
		uk: 'Яка база даних підходить для якої потреби?'
	},
	pool: { en: 'Managed cloud databases', de: 'Verwaltete Cloud-Datenbanken', uk: 'Керовані хмарні бази даних' },
	restarts: { en: 'Survives hard restarts', de: 'Übersteht harte Neustarts', uk: 'Витримує жорсткі перезапуски' },
	replicas: { en: 'Scales with replicas', de: 'Skaliert mit Replikaten', uk: 'Масштабується репліками' }
};

/** Box slot in the pool (by box index) and in its category column (by index within the category). */
const poolSlot = (i) => ({ x: 430 + (i % 3) * 260, y: 380 + Math.floor(i / 3) * 130 });
const catSlot = (cat, j) => ({ x: cat === 'restarts' ? 190 : 1190, y: 330 + j * 120 });

/**
 * @typedef {{ el: SVGGElement, cat: string, pool: { x: number, y: number }, home: { x: number, y: number } }} Box
 * @typedef {{ svg: SVGSVGElement | null, boxes: Box[], cats: Map<string, SVGGElement>, state: number, tl: Timeline | null }} Mount
 */
/** @type {WeakMap<SlideContext, Mount>} */
const mounts = new WeakMap();

/** Is `cat` revealed at `state`? */
const shown = (cat, state) => state > CATS.indexOf(cat);

/** @param {Mount} m @param {number} state */
function applyState(m, state) {
	m.tl?.cancel();
	m.tl = null;
	m.state = state;
	if (!m.svg) return;
	for (const [cat, el] of m.cats) utils.set(el, { opacity: shown(cat, state) ? 1 : 0 });
	for (const b of m.boxes) {
		const p = shown(b.cat, state) ? b.home : b.pool;
		utils.set(b.el, { translateX: p.x, translateY: p.y });
	}
}

/** @param {SlideContext} ctx @param {Mount} m */
function paint(ctx, m) {
	const svg = m.svg;
	if (!svg) return;
	const fg = ctx.color('fg');
	const bg = ctx.color('bg');
	const muted = ctx.color('muted');
	for (const el of svg.querySelectorAll('[data-i18n]')) {
		el.textContent = ctx.t(TEXT[/** @type {keyof typeof TEXT} */ (el.getAttribute('data-i18n'))]);
	}
	svg.querySelector('[data-i18n="title"]')?.setAttribute('fill', fg);
	const pool = svg.querySelector('[data-role="pool"]');
	pool?.querySelector('ellipse')?.setAttribute('stroke', muted);
	pool?.querySelector('text')?.setAttribute('fill', muted);
	for (const [cat, el] of m.cats) {
		const c = cat === 'restarts' ? ctx.color('accent') : ctx.color('accent2');
		el.querySelector('rect')?.setAttribute('fill', c);
		el.querySelector('rect')?.setAttribute('stroke', c);
		el.querySelector('text')?.setAttribute('fill', bg);
	}
	for (const b of m.boxes) {
		b.el.querySelector('rect')?.setAttribute('fill', bg);
		b.el.querySelector('rect')?.setAttribute('stroke', fg);
		b.el.querySelector('text')?.setAttribute('fill', fg);
	}
}

/**
 * Wraps a running timeline as a step handle. reverse() flips the same timeline from where it is and
 * hands back a new handle for the reversed run, whose own reverse() flips it again.
 * @param {Mount} m @param {Timeline} tl @param {number} target state the current run ends in
 * @param {number} origin state the run started from
 * @returns {StepHandle}
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

/** @type {SlideDef} */
export default {
	name: 'diagram',
	label: { en: 'Diagram', de: 'Diagramm', uk: 'Діаграма' },
	states: [{ name: 'cloud' }, { name: 'restarts' }, { name: 'replicas' }],

	mount(ctx) {
		/** @type {Mount} */
		const m = { svg: null, boxes: [], cats: new Map(), state: 0, tl: null };
		mounts.set(ctx, m);
		fetch(SVG_URL, { signal: ctx.signal })
			.then((r) => {
				if (!r.ok) throw new Error(`${SVG_URL} answered ${r.status}`);
				return r.text();
			})
			.then((text) => {
				if (ctx.signal.aborted) return;
				const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
				const svg = /** @type {SVGSVGElement} */ (document.importNode(doc.documentElement, true));
				svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
				svg.setAttribute('role', 'img');
				ctx.root.append(svg);
				m.svg = svg;
				for (const cat of CATS) {
					const el = svg.querySelector(`[data-cat="${cat}"]`);
					if (el) m.cats.set(cat, /** @type {SVGGElement} */ (el));
				}
				const seen = { restarts: 0, replicas: 0 };
				m.boxes = [...svg.querySelectorAll('.box')].map((el, i) => {
					const cat = el.getAttribute('data-box') ?? 'restarts';
					const home = catSlot(cat, seen[cat]++);
					return { el: /** @type {SVGGElement} */ (el), cat, pool: poolSlot(i), home };
				});
				paint(ctx, m);
				applyState(m, m.state);
			})
			.catch((err) => {
				if (err?.name !== 'AbortError') console.error('Demo diagram failed to load', err);
			});
	},

	snap(ctx, state) {
		const m = mounts.get(ctx);
		if (m) applyState(m, state);
	},

	step(ctx, from, to) {
		const m = mounts.get(ctx);
		if (!m) return;
		// The controller finished any running step already; drop its timeline.
		m.tl?.cancel();
		if (!m.svg) {
			// Still loading: the state is applied once the SVG arrives.
			m.state = to;
			return;
		}
		const forward = to > from;
		const cat = CATS[Math.max(from, to) - 1];
		const label = m.cats.get(cat);
		const boxes = m.boxes.filter((b) => b.cat === cat);
		const tl = createTimeline({ defaults: { ease: 'inOutCubic' } });
		const labelAt = forward ? 0 : 200 + boxes.length * 120;
		if (label) tl.add(label, { opacity: forward ? [0, 1] : [1, 0], duration: 350 }, labelAt);
		boxes.forEach((b, j) => {
			const [a, z] = forward ? [b.pool, b.home] : [b.home, b.pool];
			tl.add(b.el, { translateX: [a.x, z.x], translateY: [a.y, z.y], duration: 700 }, (forward ? 200 : 0) + j * 120);
		});
		m.tl = tl;
		return handleFor(m, tl, to, from);
	},

	finish(ctx) {
		mounts.get(ctx)?.tl?.complete();
	},

	update(ctx) {
		const m = mounts.get(ctx);
		if (m) paint(ctx, m);
	},

	unmount(ctx) {
		mounts.get(ctx)?.tl?.cancel();
		mounts.delete(ctx);
	}
};

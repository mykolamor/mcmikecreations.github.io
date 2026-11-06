// Slide 1: three bullets, one more per state. Each step fades and slides a single bullet in or out
// with an anime.js animate(); the dot and the text are staggered.
import { animate, stagger, utils } from 'animejs';

/** @typedef {import('../../../../../../src/lib/presentation/types').SlideContext} SlideContext */
/** @typedef {import('../../../../../../src/lib/presentation/types').SlideDef} SlideDef */

const TITLE = {
	en: 'Why build presentations in the browser?',
	de: 'Warum Präsentationen im Browser bauen?',
	uk: 'Навіщо створювати презентації в браузері?'
};

const BULLETS = [
	{
		en: 'Slides are code: diagrams, charts and 3D scenes stay live.',
		de: 'Folien sind Code: Diagramme, Charts und 3D-Szenen bleiben lebendig.',
		uk: 'Слайди — це код: діаграми, графіки й 3D-сцени залишаються живими.'
	},
	{
		en: 'Every state has a name, so a link can open any of them.',
		de: 'Jeder Zustand hat einen Namen, also kann ein Link jeden davon öffnen.',
		uk: 'Кожен стан має назву, тож посилання може відкрити будь-який із них.'
	},
	{
		en: 'Language and theme switch in place, without replaying anything.',
		de: 'Sprache und Theme wechseln an Ort und Stelle, ohne etwas neu abzuspielen.',
		uk: 'Мова й тема змінюються на місці, нічого не відтворюючи заново.'
	}
];

const SHIFT = -48;

/** Per-mount DOM (the same slide object is mounted on the stage and in grid thumbnails). */
/** @type {WeakMap<SlideContext, { title: HTMLElement, items: { li: HTMLElement, dot: HTMLElement, text: HTMLElement }[], anim: import('animejs').JSAnimation | null }>} */
const mounts = new WeakMap();

/** @param {HTMLElement} el @param {boolean} shown */
function place(el, shown) {
	utils.set(el, { opacity: shown ? 1 : 0, translateX: shown ? 0 : SHIFT });
}

/** @param {SlideContext} ctx */
function paint(ctx) {
	const m = mounts.get(ctx);
	if (!m) return;
	m.title.textContent = ctx.t(TITLE);
	m.title.style.color = ctx.color('fg');
	m.items.forEach(({ dot, text }, i) => {
		text.textContent = ctx.t(BULLETS[i]);
		text.style.color = ctx.color('fg');
		dot.style.background = i % 2 ? ctx.color('accent2') : ctx.color('accent');
	});
}

/** @type {SlideDef} */
export default {
	name: 'text',
	label: { en: 'Bullets', de: 'Stichpunkte', uk: 'Пункти' },
	states: [{ name: 'empty' }, { name: 'one' }, { name: 'two' }, { name: 'three' }],

	mount(ctx) {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'position:absolute;inset:0;padding:120px 160px;box-sizing:border-box;font-family:inherit;';
		const title = document.createElement('h2');
		title.style.cssText = 'margin:0 0 80px;font-size:64px;line-height:1.15;font-weight:700;';
		const list = document.createElement('ul');
		list.style.cssText = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:48px;';
		const items = BULLETS.map(() => {
			const li = document.createElement('li');
			li.style.cssText = 'display:flex;align-items:center;gap:32px;font-size:40px;line-height:1.3;';
			const dot = document.createElement('span');
			dot.style.cssText = 'flex:none;width:24px;height:24px;border-radius:50%;';
			const text = document.createElement('span');
			li.append(dot, text);
			list.append(li);
			return { li, dot, text };
		});
		wrap.append(title, list);
		ctx.root.append(wrap);
		mounts.set(ctx, { title, items, anim: null });
		paint(ctx);
	},

	snap(ctx, state) {
		const m = mounts.get(ctx);
		if (!m) return;
		m.anim?.cancel();
		m.anim = null;
		m.items.forEach(({ li, dot, text }, i) => {
			li.style.opacity = '1';
			place(dot, i < state);
			place(text, i < state);
		});
	},

	step(ctx, from, to) {
		const m = mounts.get(ctx);
		if (!m) return;
		// The controller finished any running step already; drop its animation.
		m.anim?.cancel();
		const forward = to > from;
		const item = m.items[forward ? from : to];
		const anim = animate([item.dot, item.text], {
			opacity: forward ? [0, 1] : [1, 0],
			translateX: forward ? [SHIFT, 0] : [0, SHIFT],
			duration: 500,
			delay: stagger(90, { reversed: !forward }),
			ease: forward ? 'outCubic' : 'inCubic'
		});
		m.anim = anim;
		return {
			finish: () => { anim.complete(); },
			finished: anim.then()
		};
	},

	finish(ctx) {
		mounts.get(ctx)?.anim?.complete();
	},

	update(ctx) {
		paint(ctx);
	},

	unmount(ctx) {
		mounts.get(ctx)?.anim?.cancel();
		mounts.delete(ctx);
	}
};

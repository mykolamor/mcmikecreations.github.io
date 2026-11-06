import type { SlideHost } from './controller';
import { pick } from './localize';
import { mountWindow } from './mount-window';
import { color } from './theme';
import type { Direction, Env, NormalizedPresentation, SlideContext, SlideDef, StepHandle, StepResult } from './types';

type Hook = 'mount' | 'snap' | 'step' | 'enter' | 'leave' | 'finish' | 'update' | 'unmount' | 'cleanup' | 'thumbnails';
type Claim = (el: Element, kinds: ('keys' | 'drag')[]) => void;

/** Hidden slides stay laid out (SVG/text measurement, renderer sizing) but are invisible and take no input. */
function setVisible(root: HTMLElement, visible: boolean): void {
	root.style.visibility = visible ? 'visible' : 'hidden';
	root.inert = !visible;
}

/** One mounted copy of a slide: a stage slide or a grid/offscreen thumbnail. */
interface Mounted {
	index: number;
	def: SlideDef;
	root: HTMLElement;
	ctx: SlideContext;
	abort: AbortController;
	cleanup: (() => void) | null;
}

const isHandle = (r: unknown): r is StepHandle =>
	r !== null && typeof r === 'object' && typeof (r as StepHandle).finish === 'function';
const isThenable = (r: unknown): r is Promise<unknown> =>
	r !== null && (typeof r === 'object' || typeof r === 'function') && typeof (r as Promise<unknown>).then === 'function';

/** Owns the slide DOM: keeps the current slide and its neighbours mounted inside `stage`. */
export class DomSlideHost implements SlideHost {
	#p: NormalizedPresentation;
	#stage: HTMLElement;
	#env: () => Env;
	#claim: Claim;
	/** Stage slides by index (current + neighbours). */
	#slides = new Map<number, Mounted>();
	/** Grid and offscreen thumbnail mounts. */
	#thumbs = new Set<Mounted>();
	#thumbCache = new Map<string, Promise<string[]>>();
	/** Serialises function-thumbnail captures so heavy slides are never live all at once. */
	#thumbQueue: Promise<unknown> = Promise.resolve();
	#destroyed = false;

	constructor(p: NormalizedPresentation, stage: HTMLElement, env: () => Env, claim: Claim) {
		this.#p = p;
		this.#stage = stage;
		this.#env = env;
		this.#claim = claim;
	}

	show(slide: number, state: number): void {
		if (this.#destroyed || !this.#p.slides[slide]) return;
		const keep = mountWindow(slide, this.#p.slides.length);
		for (const [i, m] of this.#slides) {
			if (!keep.includes(i)) {
				this.#slides.delete(i);
				this.#unmount(m);
			}
		}
		// Current first, then neighbours.
		for (const i of [slide, ...keep.filter((i) => i !== slide)]) {
			const target = i === slide ? state : i > slide ? 0 : this.#p.slides[i].states.length - 1;
			let m = this.#slides.get(i);
			if (!m) {
				const root = document.createElement('div');
				root.className = 'pres-slide';
				root.dataset.slide = String(i);
				root.style.cssText = 'position:absolute;left:0;top:0;width:1600px;height:900px;';
				this.#stage.appendChild(root);
				m = this.#mount(i, root, target, false);
				this.#slides.set(i, m);
			} else {
				// A neighbour may be at a stale state; snap is idempotent, so always re-snap.
				this.#call(m, 'snap', target);
			}
			setVisible(m.root, i === slide);
		}
	}

	snap(slide: number, state: number): void {
		const m = this.#slides.get(slide);
		if (m) this.#call(m, 'snap', state);
	}

	step(slide: number, from: number, to: number): StepHandle | null {
		const m = this.#slides.get(slide);
		return m ? this.#handle(m, this.#call(m, 'step', from, to) as StepResult) : null;
	}

	enter(slide: number, state: number, direction: Direction, animate: boolean): StepHandle | null {
		const m = this.#slides.get(slide);
		return m ? this.#handle(m, this.#call(m, 'enter', state, direction, animate) as StepResult) : null;
	}

	leave(slide: number): void {
		const m = this.#slides.get(slide);
		if (m) this.#call(m, 'leave');
	}

	update(env: Env): void {
		for (const m of [...this.#slides.values(), ...this.#thumbs]) this.#call(m, 'update', env);
	}

	/** Live grid thumbnail: mounts slide `slide` into `root` (isThumbnail), snaps to `state`. Returns cleanup. */
	mountInto(slide: number, root: HTMLElement, state: number, isThumbnail: true): () => void {
		if (this.#destroyed || !this.#p.slides[slide]) return () => {};
		const m = this.#mount(slide, root, state, isThumbnail);
		this.#thumbs.add(m);
		let done = false;
		return () => {
			if (done) return;
			done = true;
			// Already torn down if the host was destroyed first.
			if (this.#thumbs.delete(m)) this.#unmount(m, false);
		};
	}

	/**
	 * Per-state thumbnail image URLs for `thumbnail: 'image'`. An array is returned as is; a function is
	 * run against a temporary offscreen mount, one state at a time. Cached per slide + lang + theme.
	 */
	thumbnailImages(slide: number): Promise<string[]> {
		const s = this.#p.slides[slide];
		const thumbs = s?.def.thumbnails;
		if (!thumbs) return Promise.resolve([]);
		if (Array.isArray(thumbs)) return Promise.resolve(thumbs);
		const { lang, theme } = this.#env();
		const key = `${slide}|${lang}|${theme}`;
		const cached = this.#thumbCache.get(key);
		if (cached) return cached;
		const run = () => this.#captureThumbnails(slide, thumbs);
		const result = this.#thumbQueue.then(run, run);
		this.#thumbQueue = result.catch(() => {});
		this.#thumbCache.set(key, result);
		result.catch(() => { if (this.#thumbCache.get(key) === result) this.#thumbCache.delete(key); });
		return result;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const m of this.#slides.values()) this.#unmount(m);
		this.#slides.clear();
		for (const m of this.#thumbs) this.#unmount(m, false);
		this.#thumbs.clear();
		this.#thumbCache.clear();
	}

	async #captureThumbnails(
		slide: number,
		fn: (ctx: SlideContext, state: number) => string | Promise<string>
	): Promise<string[]> {
		if (this.#destroyed) return [];
		const el = document.createElement('div');
		// Inside the stage so the frame's --pres-* variables and CSS apply; laid out but invisible and inert.
		el.setAttribute('aria-hidden', 'true');
		el.style.cssText = 'position:absolute;left:0;top:0;width:1600px;height:900px;';
		setVisible(el, false);
		this.#stage.appendChild(el);
		const m = this.#mount(slide, el, 0, true);
		this.#thumbs.add(m);
		try {
			const out: string[] = [];
			for (let k = 0; k < this.#p.slides[slide].states.length; k++) {
				if (this.#destroyed) break;
				this.#call(m, 'snap', k);
				try {
					out.push(await fn(m.ctx, k));
				} catch (err) {
					this.#report(m, 'thumbnails', err);
					throw err;
				}
			}
			return out;
		} finally {
			if (this.#thumbs.delete(m)) this.#unmount(m, false);
			el.remove();
		}
	}

	#mount(index: number, root: HTMLElement, state: number, isThumbnail: boolean): Mounted {
		const def = this.#p.slides[index].def;
		const abort = new AbortController();
		const env = this.#env;
		const claim = this.#claim;
		const ctx: SlideContext = {
			root,
			isThumbnail,
			signal: abort.signal,
			get lang() { return env().lang; },
			get theme() { return env().theme; },
			get reducedMotion() { return env().reducedMotion; },
			t: (v) => pick(v, env().lang),
			color: (n) => color(root, n),
			claimInput: (el, kinds) => { if (!isThumbnail) claim(el, kinds); },
		};
		const m: Mounted = { index, def, root, ctx, abort, cleanup: null };
		if (def.html) root.innerHTML = def.html;
		const cleanup = this.#call(m, 'mount');
		if (typeof cleanup === 'function') m.cleanup = cleanup as () => void;
		this.#call(m, 'snap', state);
		return m;
	}

	/** unmount hook → returned cleanup → abort signal → remove root (or just empty a borrowed root). */
	#unmount(m: Mounted, removeRoot = true): void {
		this.#call(m, 'unmount');
		if (m.cleanup) {
			try { m.cleanup(); } catch (err) { this.#report(m, 'cleanup', err); }
			m.cleanup = null;
		}
		m.abort.abort();
		if (removeRoot) m.root.remove();
		else m.root.replaceChildren();
	}

	#handle(m: Mounted, r: StepResult): StepHandle | null {
		if (isHandle(r)) return r;
		if (isThenable(r)) return { finished: r, finish: () => { this.#call(m, 'finish'); } };
		return null;
	}

	#call(m: Mounted, hook: Exclude<Hook, 'cleanup' | 'thumbnails'>, ...args: unknown[]): unknown {
		const fn = m.def[hook] as ((ctx: SlideContext, ...a: unknown[]) => unknown) | undefined;
		if (typeof fn !== 'function') return undefined;
		try {
			const r = fn.call(m.def, m.ctx, ...args);
			// step/enter promises become handle.finished (observed by the controller); other async hooks are caught here.
			if (hook !== 'step' && hook !== 'enter' && isThenable(r)) r.then(undefined, (err) => this.#report(m, hook, err));
			return r;
		} catch (err) {
			this.#report(m, hook, err);
			return undefined;
		}
	}

	#report(m: Mounted, hook: Hook, err: unknown): void {
		const name = this.#p.slides[m.index]?.name;
		console.error(`Presentation slide ${name ?? m.index} ${hook} failed`, err);
	}
}

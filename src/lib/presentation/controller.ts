import { adjacency, neighbour, resolve } from './order';
import type { Direction, Env, Lang, NormalizedPresentation, Position, PositionRef, StepHandle, Theme } from './types';

/** What the controller drives. Implementations own the DOM; the controller owns order and timing. */
export interface SlideHost {
	show(slide: number, state: number): void;   // make current: mount (+ neighbours), snap to state, visible
	snap(slide: number, state: number): void;
	step(slide: number, from: number, to: number): StepHandle | null;
	enter(slide: number, state: number, direction: Direction, animate: boolean): StepHandle | null;
	leave(slide: number): void;
	update(env: Env): void;
}

export type ControllerEvent = 'change' | 'enter' | 'leave';
type Listener = (pos: Position) => void;

interface Running {
	handle: StepHandle;
	/** Only same-slide steps may be reversed in place (Ruling 1); entrances are always finished. */
	kind: 'step' | 'enter';
	dir: 1 | -1;
	from: Position;
}

/** Framework-free, synchronous navigation state machine. Never queues input: latest input wins. */
export class PresentationController {
	#p: NormalizedPresentation;
	#host: SlideHost;
	#pos: Position;
	#env: Env;
	#running: Running | null = null;
	#listeners: Record<ControllerEvent, Set<Listener>> = { change: new Set(), enter: new Set(), leave: new Set() };
	#destroyed = false;

	constructor(p: NormalizedPresentation, host: SlideHost, start: Position, env: Env) {
		this.#p = p;
		this.#host = host;
		this.#pos = { slide: start.slide, state: start.state };
		this.#env = { ...env };
		this.#call('show', () => host.show(start.slide, start.state));
		this.#track(this.#call('enter', () => host.enter(start.slide, start.state, 'forward', false)), 'enter', 1, this.#pos);
	}

	get position(): Position & { slideName?: string; stateName?: string } {
		const { slide, state } = this.#pos;
		const s = this.#p.slides[slide];
		const out: Position & { slideName?: string; stateName?: string } = { slide, state };
		if (s?.name !== undefined) out.slideName = s.name;
		const stName = s?.states[state]?.name;
		if (stName !== undefined) out.stateName = stName;
		return out;
	}

	get env(): Env { return { ...this.#env }; }

	next(): void { this.#move(1); }
	prev(): void { this.#move(-1); }
	first(): void { this.goTo({ slide: 0, state: 0 }); }
	last(): void {
		const slide = this.#p.slides.length - 1;
		this.goTo({ slide, state: this.#p.slides[slide].states.length - 1 });
	}

	goTo(ref: PositionRef, opts: { animate?: boolean } = {}): boolean {
		if (this.#destroyed) return false;
		const target = resolve(this.#p, ref);
		if (!target) return false;
		const cur = this.#pos;
		if (target.slide === cur.slide && target.state === cur.state) return true;
		if (opts.animate) {
			const dir = adjacency(this.#p, cur, target);
			if (dir !== 0) { this.#move(dir); return true; }
		}
		this.#finishRunning();
		if (target.slide === cur.slide) {
			this.#call('snap', () => this.#host.snap(target.slide, target.state));
			this.#pos = target;
		} else {
			this.#crossSlide(target, target.slide > cur.slide ? 1 : -1, false);
		}
		this.#emit('change', this.#pos);
		return true;
	}

	setLanguage(lang: Lang): void { this.#setEnv('lang', lang); }
	setTheme(theme: Theme): void { this.#setEnv('theme', theme); }
	setReducedMotion(on: boolean): void { this.#setEnv('reducedMotion', on); }

	on(event: ControllerEvent, fn: Listener): () => void {
		const set = this.#listeners[event];
		if (this.#destroyed) return () => {};
		set.add(fn);
		return () => { set.delete(fn); };
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#finishRunning();
		this.#destroyed = true;
		for (const set of Object.values(this.#listeners)) set.clear();
	}

	#move(dir: 1 | -1): void {
		if (this.#destroyed) return;
		const r = this.#running;
		// 1. Opposite direction on a running same-slide step: reverse in place.
		if (r && r.kind === 'step' && r.dir !== dir && typeof r.handle.reverse === 'function') {
			const handle = r.handle;
			let reversed: StepHandle | null | undefined;
			let ok = true;
			try { reversed = handle.reverse!(); } catch (e) { ok = false; console.error('presentation: reverse() threw', e); }
			if (ok) {
				const back = r.from;
				const from = this.#pos;
				this.#running = null;
				this.#pos = { slide: back.slide, state: back.state };
				this.#track(reversed ?? null, 'step', dir, from);
				this.#emit('change', this.#pos);
				return;
			}
		}
		// 2. Never queue: whatever is running is finished.
		this.#finishRunning();
		// 3. Boundary: no-op.
		const from = this.#pos;
		const to = neighbour(this.#p, from, dir);
		if (!to) return;
		if (to.slide === from.slide) {
			// 4. Same slide.
			let handle: StepHandle | null = null;
			if (this.#env.reducedMotion) this.#call('snap', () => this.#host.snap(to.slide, to.state));
			else handle = this.#call('step', () => this.#host.step(to.slide, from.state, to.state));
			// 6. Position moves before the animation completes.
			this.#pos = to;
			this.#track(handle, 'step', dir, from);
		} else {
			// 5. Different slide.
			this.#crossSlide(to, dir, !this.#env.reducedMotion);
		}
		this.#emit('change', this.#pos);
	}

	/** leave old → emit leave → show new → enter new → emit enter. Sets position and tracks the entrance. */
	#crossSlide(to: Position, dir: 1 | -1, animate: boolean): void {
		const from = this.#pos;
		this.#call('leave', () => this.#host.leave(from.slide));
		this.#emit('leave', from);
		this.#call('show', () => this.#host.show(to.slide, to.state));
		const direction: Direction = dir > 0 ? 'forward' : 'backward';
		const handle = this.#call('enter', () => this.#host.enter(to.slide, to.state, direction, animate));
		this.#pos = to;
		this.#track(handle, 'enter', dir, from);
		this.#emit('enter', to);
	}

	#setEnv<K extends keyof Env>(key: K, value: Env[K]): void {
		if (this.#destroyed || this.#env[key] === value) return;
		this.#finishRunning();
		this.#env = { ...this.#env, [key]: value };
		const env = this.env;
		this.#call('update', () => this.#host.update(env));
	}

	#track(handle: StepHandle | null | undefined, kind: Running['kind'], dir: 1 | -1, from: Position): void {
		if (!handle) return;
		const running: Running = { handle, kind, dir, from: { slide: from.slide, state: from.state } };
		this.#running = running;
		const clear = () => { if (this.#running === running) this.#running = null; };
		try {
			Promise.resolve(handle.finished).then(clear, clear);
		} catch (e) {
			console.error('presentation: invalid step handle', e);
			clear();
		}
	}

	#finishRunning(): void {
		const r = this.#running;
		if (!r) return;
		this.#running = null;
		try { r.handle.finish(); } catch (e) { console.error('presentation: finish() threw', e); }
	}

	#call<T>(name: string, fn: () => T): T | null {
		try {
			return fn() ?? null;
		} catch (e) {
			console.error(`presentation: host.${name}() threw`, e);
			return null;
		}
	}

	#emit(event: ControllerEvent, pos: Position): void {
		for (const fn of [...this.#listeners[event]]) {
			try { fn({ slide: pos.slide, state: pos.state }); } catch (e) { console.error(`presentation: '${event}' listener threw`, e); }
		}
	}
}

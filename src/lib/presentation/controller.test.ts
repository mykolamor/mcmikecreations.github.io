import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './order';
import { PresentationController, type SlideHost } from './controller';
import type { Env, Position, PresentationDef, StepHandle } from './types';

interface FakeHandle extends StepHandle { id: number; resolve(): void; reject(e?: unknown): void; }

function makeHost() {
	const calls: string[] = [];
	const queue: (StepHandle | null)[] = [];
	let nextId = 1;
	function fakeHandle({ reversible = false }: { reversible?: boolean } = {}): FakeHandle {
		const id = nextId++;
		let resolve!: () => void;
		let reject!: (e?: unknown) => void;
		const finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
		finished.catch(() => {});
		const h: FakeHandle = {
			id, finished, resolve: () => resolve(), reject: (e) => reject(e),
			finish: () => { calls.push(`finish#${id}`); },
		};
		if (reversible) h.reverse = () => { calls.push(`reverse#${id}`); return fakeHandle({ reversible: true }); };
		return h;
	}
	const throwing = new Set<keyof SlideHost>();
	const host: SlideHost = {
		show: (s, st) => { calls.push(`show ${s} ${st}`); if (throwing.has('show')) throw new Error('show'); },
		snap: (s, st) => { calls.push(`snap ${s} ${st}`); if (throwing.has('snap')) throw new Error('snap'); },
		step: (s, f, t) => { calls.push(`step ${s} ${f}>${t}`); if (throwing.has('step')) throw new Error('step'); return queue.shift() ?? null; },
		enter: (s, st, d, a) => { calls.push(`enter ${s} ${st} ${d} ${a}`); if (throwing.has('enter')) throw new Error('enter'); return queue.shift() ?? null; },
		leave: (s) => { calls.push(`leave ${s}`); if (throwing.has('leave')) throw new Error('leave'); },
		update: (e) => { calls.push(`update ${e.lang} ${e.theme}`); if (throwing.has('update')) throw new Error('update'); },
	};
	return { host, calls, queue, fakeHandle, throwing };
}

const env: Env = { lang: 'en', theme: 'light', reducedMotion: false };
const def: PresentationDef = { slides: [{ states: 2 }, { states: 2 }] };

function setup(start: Position = { slide: 0, state: 0 }, d: PresentationDef = def, e: Env = env) {
	const h = makeHost();
	const c = new PresentationController(normalize(d), h.host, start, { ...e });
	h.calls.length = 0;
	const events: string[] = [];
	for (const ev of ['change', 'enter', 'leave'] as const) c.on(ev, (p) => events.push(`${ev} ${p.slide} ${p.state}`));
	return { ...h, c, events };
}
const pos = (c: PresentationController) => ({ slide: c.position.slide, state: c.position.state });
const tick = () => new Promise((r) => setImmediate(r));

function silenceErrors() {
	const orig = console.error;
	const logged: unknown[][] = [];
	console.error = (...args: unknown[]) => { logged.push(args); };
	return { logged, restore: () => { console.error = orig; } };
}

test('constructor shows and enters the start without animation', () => {
	const h = makeHost();
	const events: string[] = [];
	const c = new PresentationController(normalize(def), h.host, { slide: 0, state: 0 }, { ...env });
	c.on('change', () => events.push('change'));
	assert.deepEqual(h.calls, ['show 0 0', 'enter 0 0 forward false']);
	assert.deepEqual(events, []);
	assert.deepEqual(pos(c), { slide: 0, state: 0 });
});

test('next within a slide steps and moves position at once', () => {
	const { c, calls, queue, fakeHandle, events } = setup();
	queue.push(fakeHandle());
	c.next();
	assert.deepEqual(calls, ['step 0 0>1']);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
	assert.deepEqual(events, ['change 0 1']);
});

test('next past last state leaves, shows next slide at 0, enters forward', () => {
	const { c, calls, events } = setup({ slide: 0, state: 1 });
	c.next();
	assert.deepEqual(calls, ['leave 0', 'show 1 0', 'enter 1 0 forward true']);
	assert.deepEqual(pos(c), { slide: 1, state: 0 });
	assert.deepEqual(events, ['leave 0 1', 'enter 1 0', 'change 1 0']);
});

test('prev from state 0 shows previous slide at its last state, enters backward', () => {
	const { c, calls, events } = setup({ slide: 1, state: 0 });
	c.prev();
	assert.deepEqual(calls, ['leave 1', 'show 0 1', 'enter 0 1 backward true']);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
	assert.deepEqual(events, ['leave 1 0', 'enter 0 1', 'change 0 1']);
});

test('input during a running step finishes it first, never queues', () => {
	const { c, calls, queue, fakeHandle } = setup();
	queue.push(fakeHandle(), fakeHandle(), fakeHandle());
	c.next(); c.next(); c.next();
	assert.deepEqual(calls, [
		'step 0 0>1',
		'finish#1', 'leave 0', 'show 1 0', 'enter 1 0 forward true',
		'finish#2', 'step 1 0>1',
	]);
	assert.deepEqual(pos(c), { slide: 1, state: 1 });
});

test('hammering through a cross-slide entrance finishes the entrance handle', () => {
	// Ruling 1: a running entrance is finished (never reversed), then the move proceeds.
	const { c, calls, queue, fakeHandle } = setup({ slide: 0, state: 1 });
	queue.push(fakeHandle({ reversible: true }), fakeHandle());
	c.next();
	c.prev();
	assert.deepEqual(calls, [
		'leave 0', 'show 1 0', 'enter 1 0 forward true',
		'finish#1', 'leave 1', 'show 0 1', 'enter 0 1 backward true',
	]);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });

	const f = setup({ slide: 0, state: 1 });
	f.queue.push(f.fakeHandle({ reversible: true }), f.fakeHandle());
	f.c.next();
	f.c.next();
	assert.deepEqual(f.calls.slice(3), ['finish#1', 'step 1 0>1']);
	assert.deepEqual(pos(f.c), { slide: 1, state: 1 });
});

test('opposite direction reverses in place when reverse() exists', () => {
	const { c, calls, queue, fakeHandle, events } = setup();
	queue.push(fakeHandle({ reversible: true }));
	c.next();
	c.prev();
	assert.deepEqual(calls, ['step 0 0>1', 'reverse#1']);
	assert.deepEqual(pos(c), { slide: 0, state: 0 });
	assert.deepEqual(events, ['change 0 1', 'change 0 0']);
	// The reversed handle is now running in the backward direction: next reverses it again.
	c.next();
	assert.deepEqual(calls, ['step 0 0>1', 'reverse#1', 'reverse#2']);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
	// Same direction as the running reversal: finish it and move on.
	c.next();
	assert.deepEqual(calls.slice(3), ['finish#3', 'leave 0', 'show 1 0', 'enter 1 0 forward true']);
});

test('opposite direction without reverse finishes then steps back', () => {
	const { c, calls, queue, fakeHandle } = setup();
	queue.push(fakeHandle());
	c.next();
	c.prev();
	assert.deepEqual(calls, ['step 0 0>1', 'finish#1', 'step 0 1>0']);
	assert.deepEqual(pos(c), { slide: 0, state: 0 });
});

test('a settled handle is no longer finished on the next press', async () => {
	const { c, calls, queue, fakeHandle } = setup();
	const h = fakeHandle({ reversible: true });
	queue.push(h);
	c.next();
	h.resolve();
	await tick();
	c.prev();
	assert.deepEqual(calls, ['step 0 0>1', 'step 0 1>0']);
});

test('a rejected finished promise also clears running', async () => {
	const { c, calls, queue, fakeHandle } = setup();
	const h = fakeHandle();
	queue.push(h);
	c.next();
	h.reject(new Error('aborted'));
	await tick();
	c.next();
	assert.deepEqual(calls, ['step 0 0>1', 'leave 0', 'show 1 0', 'enter 1 0 forward true']);
});

test('a stale settlement does not clear a newer running handle', async () => {
	const { c, calls, queue, fakeHandle } = setup();
	const h1 = fakeHandle();
	queue.push(h1, fakeHandle());
	c.next();
	c.next(); // finishes #1, runs entrance #2
	h1.resolve();
	await tick();
	c.next();
	assert.deepEqual(calls.slice(-2), ['finish#2', 'step 1 0>1']);
});

test('goTo non-adjacent snaps without animation', () => {
	const { c, calls, events } = setup();
	assert.equal(c.goTo({ slide: 1, state: 1 }), true);
	assert.deepEqual(calls, ['leave 0', 'show 1 1', 'enter 1 1 forward false']);
	assert.deepEqual(pos(c), { slide: 1, state: 1 });
	assert.deepEqual(events, ['leave 0 0', 'enter 1 1', 'change 1 1']);
});

test('goTo backward to an earlier slide enters backward without animation', () => {
	const { c, calls } = setup({ slide: 1, state: 1 });
	c.goTo({ slide: 0, state: 0 });
	assert.deepEqual(calls, ['leave 1', 'show 0 0', 'enter 0 0 backward false']);
});

test('goTo adjacent with animate behaves like next', () => {
	const { c, calls, events } = setup({ slide: 0, state: 1 });
	assert.equal(c.goTo({ slide: 1, state: 0 }, { animate: true }), true);
	assert.deepEqual(calls, ['leave 0', 'show 1 0', 'enter 1 0 forward true']);
	assert.deepEqual(events, ['leave 0 1', 'enter 1 0', 'change 1 0']);

	const b = setup();
	b.queue.push(b.fakeHandle({ reversible: true }));
	b.c.next();
	b.c.goTo({ slide: 0, state: 0 }, { animate: true });
	assert.deepEqual(b.calls, ['step 0 0>1', 'reverse#1']);
});

test('goTo adjacent without animate snaps', () => {
	const { c, calls } = setup();
	c.goTo({ slide: 0, state: 1 });
	assert.deepEqual(calls, ['snap 0 1']);
});

test('goTo same slide snaps', () => {
	const { c, calls, queue, fakeHandle, events } = setup();
	queue.push(fakeHandle());
	c.next();
	assert.equal(c.goTo({ slide: 0, state: 0 }), true);
	assert.deepEqual(calls, ['step 0 0>1', 'finish#1', 'snap 0 0']);
	assert.deepEqual(events, ['change 0 1', 'change 0 0']);
});

test('goTo the current position returns true and does nothing', () => {
	const { c, calls, events } = setup();
	assert.equal(c.goTo({ slide: 0, state: 0 }), true);
	assert.deepEqual(calls, []);
	assert.deepEqual(events, []);
});

test('goTo unresolved returns false and does nothing', () => {
	const { c, calls, queue, fakeHandle, events } = setup();
	queue.push(fakeHandle());
	c.next();
	assert.equal(c.goTo({ slide: 'nope' }), false);
	assert.equal(c.goTo({ slide: 0, state: 9 }), false);
	assert.deepEqual(calls, ['step 0 0>1']);
	assert.deepEqual(events, ['change 0 1']);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
});

test('reduced motion snaps steps and enters without animation', () => {
	const { c, calls } = setup({ slide: 0, state: 0 }, def, { ...env, reducedMotion: true });
	c.next();
	c.next();
	c.prev();
	assert.deepEqual(calls, [
		'snap 0 1',
		'leave 0', 'show 1 0', 'enter 1 0 forward false',
		'leave 1', 'show 0 1', 'enter 0 1 backward false',
	]);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
});

test('setReducedMotion switches later moves to snapping', () => {
	const { c, calls, queue, fakeHandle } = setup();
	queue.push(fakeHandle());
	c.next();
	c.setReducedMotion(true);
	assert.equal(c.env.reducedMotion, true);
	c.prev();
	assert.deepEqual(calls, ['step 0 0>1', 'finish#1', 'update en light', 'snap 0 0']);
});

test('setTheme finishes the running step then updates, position unchanged', () => {
	const { c, calls, queue, fakeHandle, events } = setup();
	queue.push(fakeHandle());
	c.next();
	events.length = 0;
	c.setTheme('dark');
	assert.deepEqual(calls, ['step 0 0>1', 'finish#1', 'update en dark']);
	assert.deepEqual(events, []);
	assert.deepEqual(pos(c), { slide: 0, state: 1 });
	assert.equal(c.env.theme, 'dark');
	// Unchanged value: nothing.
	c.setTheme('dark');
	assert.equal(calls.length, 3);
	// The finished handle is no longer running.
	c.prev();
	assert.deepEqual(calls.slice(3), ['step 0 1>0']);
});

test('setLanguage updates env and host, no-op when unchanged', () => {
	const { c, calls, events } = setup();
	c.setLanguage('en');
	assert.deepEqual(calls, []);
	c.setLanguage('de');
	assert.deepEqual(calls, ['update de light']);
	assert.equal(c.env.lang, 'de');
	assert.deepEqual(events, []);
});

test('boundaries are no-ops without events', () => {
	const { c, calls, events } = setup();
	c.prev();
	c.first();
	assert.deepEqual(calls, []);
	assert.deepEqual(events, []);

	const e = setup({ slide: 1, state: 1 });
	e.c.next();
	e.c.last();
	assert.deepEqual(e.calls, []);
	assert.deepEqual(e.events, []);

	const one = setup({ slide: 0, state: 0 }, { slides: [{}] });
	one.c.next(); one.c.prev(); one.c.first(); one.c.last();
	assert.equal(one.c.goTo({ slide: 0 }), true);
	assert.deepEqual(one.calls, []);
	assert.deepEqual(one.events, []);
});

test('a boundary press still finishes a running step', () => {
	const { c, calls, queue, fakeHandle, events } = setup({ slide: 1, state: 0 });
	queue.push(fakeHandle());
	c.next();
	c.next();
	assert.deepEqual(calls, ['step 1 0>1', 'finish#1']);
	assert.deepEqual(events, ['change 1 1']);
});

test('first and last snap to the ends', () => {
	const { c, calls } = setup({ slide: 0, state: 1 });
	c.last();
	assert.deepEqual(calls, ['leave 0', 'show 1 1', 'enter 1 1 forward false']);
	c.first();
	assert.deepEqual(calls.slice(3), ['leave 1', 'show 0 0', 'enter 0 0 backward false']);
});

test('a throwing step does not wedge navigation', () => {
	const s = silenceErrors();
	try {
		const { c, calls, throwing, events } = setup();
		throwing.add('step');
		c.next();
		assert.deepEqual(pos(c), { slide: 0, state: 1 });
		assert.deepEqual(events, ['change 0 1']);
		throwing.delete('step');
		c.next();
		assert.deepEqual(calls, ['step 0 0>1', 'leave 0', 'show 1 0', 'enter 1 0 forward true']);
		assert.deepEqual(pos(c), { slide: 1, state: 0 });
		assert.equal(s.logged.length, 1);
	} finally { s.restore(); }
});

test('throwing host calls, handles and listeners are all contained', () => {
	const s = silenceErrors();
	try {
		const { c, calls, throwing, queue } = setup({ slide: 0, state: 1 });
		for (const k of ['leave', 'show', 'enter', 'snap', 'update'] as const) throwing.add(k);
		c.on('change', () => { throw new Error('listener'); });
		c.next();
		assert.deepEqual(pos(c), { slide: 1, state: 0 });
		c.goTo({ slide: 1, state: 1 });
		c.setTheme('dark');
		assert.equal(c.env.theme, 'dark');
		throwing.clear();
		const bad: StepHandle = {
			finish: () => { throw new Error('finish'); },
			reverse: () => { throw new Error('reverse'); },
			finished: new Promise(() => {}),
		};
		queue.push(bad, null);
		c.prev();             // step 1 1>0, running = bad
		c.next();             // reverse throws → finish (throws) → normal step forward
		assert.deepEqual(pos(c), { slide: 1, state: 1 });
		assert.deepEqual(calls.slice(-2), ['step 1 1>0', 'step 1 0>1']);
		assert.ok(s.logged.length >= 8);
	} finally { s.restore(); }
});

test('constructor tolerates a throwing host', () => {
	const s = silenceErrors();
	try {
		const h = makeHost();
		h.throwing.add('show');
		h.throwing.add('enter');
		const c = new PresentationController(normalize(def), h.host, { slide: 0, state: 0 }, { ...env });
		h.throwing.clear();
		c.next();
		assert.deepEqual(pos(c), { slide: 0, state: 1 });
	} finally { s.restore(); }
});

test('the constructor entrance handle is finished by the first move', () => {
	const h = makeHost();
	h.queue.push(h.fakeHandle());
	const c = new PresentationController(normalize(def), h.host, { slide: 0, state: 0 }, { ...env });
	c.next();
	assert.deepEqual(h.calls, ['show 0 0', 'enter 0 0 forward false', 'finish#1', 'step 0 0>1']);
});

test('position reports names', () => {
	const d: PresentationDef = { slides: [{ name: 'intro', states: [{ name: 'a' }, {}] }, { states: 1 }] };
	const { c } = setup({ slide: 0, state: 0 }, d);
	assert.deepEqual(c.position, { slide: 0, state: 0, slideName: 'intro', stateName: 'a' });
	c.next();
	assert.deepEqual(c.position, { slide: 0, state: 1, slideName: 'intro' });
	c.next();
	assert.deepEqual(c.position, { slide: 1, state: 0 });
});

test('position and env are copies', () => {
	const { c } = setup();
	(c.position as Position).state = 1;
	(c.env as Env).theme = 'dark';
	assert.deepEqual(pos(c), { slide: 0, state: 0 });
	assert.equal(c.env.theme, 'light');
});

test('on returns an unsubscribe; destroy finishes and silences', () => {
	const { c, calls, queue, fakeHandle } = setup();
	const seen: string[] = [];
	const off = c.on('change', (p) => seen.push(`${p.slide} ${p.state}`));
	queue.push(fakeHandle());
	c.next();
	off();
	c.prev();
	assert.deepEqual(seen, ['0 1']);
	queue.push(fakeHandle());
	c.next();
	const before = calls.length;
	c.on('change', () => seen.push('after'));
	c.destroy();
	assert.deepEqual(calls.slice(before), ['finish#2']);
	c.next(); c.prev(); c.setTheme('dark');
	assert.equal(c.goTo({ slide: 1 }), false);
	assert.equal(calls.length, before + 1);
	assert.deepEqual(seen, ['0 1']);
});

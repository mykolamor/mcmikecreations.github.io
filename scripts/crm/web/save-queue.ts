import type { FieldOp } from '../shared/ops';

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';
export type SendResult = { conflict: false } | { conflict: true; doc: unknown };

export type SaveQueueOptions = {
	/** Sends ops to the server (the caller tracks the base version). Throws on failure. */
	send: (ops: FieldOp[]) => Promise<SendResult>;
	debounceMs?: number;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
};

/** Ops coalesce per field (and scope: a post override and the hike value are separate slots; and language: a German text is its own slot); all mirror edits share one slot. */
const opKey = (op: FieldOp): string => ('kind' in op ? op.kind : `${op.field}${op.scope === 'post' ? '@post' : ''}${op.lang ? `:${op.lang}` : ''}`);
const factsKey = (op: Extract<FieldOp, { kind: 'facts' }>): string => `facts@${op.scope}:${JSON.stringify(op.path)}`;

export function createSaveQueue(opts: SaveQueueOptions) {
	const debounceMs = opts.debounceMs ?? 800;
	const now = opts.now ?? Date.now;
	const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

	const pendingOps = new Map<string, FieldOp>();
	let factsSeq = 0;
	/**
	 * A facts op's slot. Facts paths address list items by index, which a removal or a reorder shifts, so a facts op takes
	 * the slot of the op right before it only when that one set the same path; every other gets a slot of its own, in order.
	 */
	const slotOf = (op: FieldOp): string => {
		if (!('kind' in op) || op.kind !== 'facts') return opKey(op);
		const last = [...pendingOps.entries()].at(-1);
		const prev = last?.[1];
		if (prev && 'kind' in prev && prev.kind === 'facts' && !prev.remove && !op.remove && factsKey(prev) === factsKey(op)) return last![0];
		return `${factsKey(op)}#${++factsSeq}`;
	};
	const listeners = new Set<() => void>();
	let timer: unknown = null;
	let chain: Promise<void> = Promise.resolve();
	let paused = false;
	let sendingOps: FieldOp[] = [];

	const q = {
		status: 'saved' as SaveStatus,
		lastSavedAt: null as number | null,
		conflictDoc: null as unknown,
		error: null as string | null,
		pending: () => [...pendingOps.values()],
		/** The ops of the batch being sent (none between sends): what the doc will hold once the save answers. */
		inFlight: () => [...sendingOps],
		subscribe(fn: () => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		queue(op: FieldOp, { debounce }: { debounce: boolean }) {
			const key = slotOf(op);
			pendingOps.delete(key);
			pendingOps.set(key, op);
			// During a conflict the status stays, but listeners still hear of the edit (the banner's "Copy my text").
			if (q.status !== 'conflict') set({ status: 'saving' });
			else for (const l of listeners) l();
			if (timer !== null) clearTimer(timer);
			timer = null;
			if (q.status === 'conflict') return;
			if (debounce) timer = setTimer(() => void q.flush(), debounceMs);
			else void q.flush();
		},
		flush(): Promise<void> {
			if (timer !== null) clearTimer(timer);
			timer = null;
			chain = chain.then(run);
			return chain;
		},
		/** Holds queued ops (still coalescing) until `resume()`; a send already in flight finishes. */
		pause() {
			paused = true;
		},
		resume() {
			paused = false;
			if (pendingOps.size && q.status !== 'conflict') void q.flush();
		},
		/** Resolves when everything started so far has finished. */
		idle: () => chain,
		/** Raise a conflict from outside a send (stale view found while edits are pending). */
		markConflict(doc: unknown) {
			if (timer !== null) clearTimer(timer);
			timer = null;
			set({ status: 'conflict', conflictDoc: doc });
		},
		/** After a conflict: 'overwrite' re-sends pending ops (caller has adopted the new base); 'discard' drops them. */
		resolve(how: 'overwrite' | 'discard') {
			q.conflictDoc = null;
			if (how === 'discard') {
				pendingOps.clear();
				set({ status: 'saved' });
			} else {
				set({ status: pendingOps.size ? 'saving' : 'saved' });
				void q.flush();
			}
		}
	};

	function set(patch: Partial<Pick<typeof q, 'status' | 'lastSavedAt' | 'error' | 'conflictDoc'>>) {
		Object.assign(q, patch);
		for (const l of listeners) l();
	}

	async function run() {
		if (paused || q.status === 'conflict' || pendingOps.size === 0) return;
		const sending = [...pendingOps.entries()];
		const ops = sending.map(([, op]) => op);
		// Set before anyone hears of the send: an op is always either queued or in flight until the save answers.
		sendingOps = ops;
		pendingOps.clear();
		set({ status: 'saving', error: null });
		// The unsent ops go back ahead of those queued meanwhile (facts ops depend on their order); a newer value of a slot wins.
		const restore = () => {
			const newer = [...pendingOps.entries()];
			pendingOps.clear();
			for (const [key, op] of sending) if (!newer.some(([k]) => k === key)) pendingOps.set(key, op);
			for (const [key, op] of newer) pendingOps.set(key, op);
		};
		try {
			const r = await opts.send(ops).finally(() => (sendingOps = []));
			if (r.conflict) {
				restore();
				set({ status: 'conflict', conflictDoc: r.doc });
				return;
			}
			set({ status: pendingOps.size ? 'saving' : 'saved', lastSavedAt: now() });
		} catch (e) {
			// A 400 will never succeed: drop these ops (reported once) instead of jamming the queue with retries.
			if ((e as { status?: number })?.status === 400) {
				set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
				return;
			}
			restore();
			set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
		}
	}

	return q;
}

const tails = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier job for the same key has finished (`lockKey` of a doc ref: a hike's sidecar and posts share one). */
export function withDocLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
	const prev = tails.get(key) ?? Promise.resolve();
	const run = prev.then(fn, fn);
	const tail = run.catch(() => undefined);
	tails.set(key, tail);
	void tail.then(() => {
		if (tails.get(key) === tail) tails.delete(key);
	});
	return run;
}

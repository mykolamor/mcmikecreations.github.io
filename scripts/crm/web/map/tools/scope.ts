import type { FieldOp } from '../../../shared/ops';

/** The bits of the doc session the map tools need. */
export type EditSession = {
	doc: { version: string; fields: Record<string, unknown> } | null;
	queue: { pending(): FieldOp[]; status?: string };
	edit(op: FieldOp, debounce: boolean): void;
};
export type Scope = 'hike' | 'post';

type Slots = { hike?: unknown; post?: unknown };

/** Where a map field is edited: the post when it carries an override (or one is being saved), else the hike. */
export function scopeOf(session: EditSession, field: string): Scope {
	const post = currentValue(session, field, 'post');
	return post !== undefined && post !== null ? 'post' : 'hike';
}

// An edit that was sent but is not in the doc yet (its PATCH is in flight). It stays until the doc slot holds that value
// (so an earlier response, which carries an older value, cannot hide it) or the queue reports a failed save.
// Kept per session (one per open hike) so one hike's in-flight value never shows in another.
const sentBy = new WeakMap<object, Map<string, unknown>>();
const sentOf = (session: EditSession): Map<string, unknown> => {
	let m = sentBy.get(session);
	if (!m) sentBy.set(session, (m = new Map()));
	return m;
};

// The server treats an empty list as "remove the key", so an empty list and null are the same value everywhere here.
const norm = (v: unknown): unknown => (Array.isArray(v) && v.length === 0 ? null : v);

/** The newest value of a field slot: unsent edit, else an in-flight one, else the doc. */
export function currentValue<T>(session: EditSession, field: string, scope: Scope): T | undefined {
	const op = [...session.queue.pending()].reverse().find((o): o is Extract<FieldOp, { field: string }> => 'field' in o && o.field === field && (o.scope ?? 'hike') === scope);
	if (op) return (norm(op.value) ?? undefined) as T | undefined;
	const key = `${field}@${scope}`;
	const sent = sentOf(session);
	const docValue = ((session.doc?.fields[field] ?? {}) as Slots)[scope] as T | undefined;
	if (sent.has(key)) {
		const status = session.queue.status;
		if (JSON.stringify(sent.get(key) ?? null) === JSON.stringify(docValue ?? null) || status === 'error' || status === 'conflict') sent.delete(key);
		else return sent.get(key) as T;
	}
	return docValue;
}

export function setField(session: EditSession, field: string, value: unknown, scope: Scope): void {
	const v = norm(value);
	sentOf(session).set(`${field}@${scope}`, v);
	session.edit({ field, value: v, scope }, false);
}

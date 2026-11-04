// The Strings tab's model: a language's label and tag table beside the English one, row by row, and the save that
// writes typed edits to it through the version protocol (one queue for the whole table). Framework-free.
import { ApiClientError, api } from '../api';

export type StringValue = string | string[];
export type StringsState = { version: string; en: Record<string, StringValue>; own: Record<string, StringValue> };

export type Row = {
	key: string;
	en: StringValue;
	/** The translation; undefined while the table lacks the key (the site shows the English). */
	own: StringValue | undefined;
	missing: boolean;
	/** The English string's placeholder names, sorted. */
	placeholders: string[];
	/** The translation lacks a placeholder the English has, or has one it lacks. */
	mismatch: boolean;
};

/** The English keys as rows, those the table lacks first, each part in English order. */
export function rows(en: Record<string, StringValue>, own: Record<string, StringValue>): Row[] {
	const all = Object.entries(en).map(([key, value]): Row => {
		const mine = own[key];
		const names = typeof value === 'string' ? placeholders(value) : [];
		const mismatch = typeof value === 'string' && typeof mine === 'string' && placeholders(mine).join() !== names.join();
		return { key, en: value, own: mine, missing: mine === undefined, placeholders: names, mismatch };
	});
	return [...all.filter((r) => r.missing), ...all.filter((r) => !r.missing)];
}

/**
 * The placeholder names in `message`, sorted: `{name}`, and the name of a select or plural form with the placeholders
 * of its cases' text. `#` and escaped braces (`'{'`) aren't any; text that doesn't parse stops the scan.
 */
export function placeholders(message: string): string[] {
	const names = new Set<string>();
	collect(message, names);
	return [...names].sort();
}

function collect(message: string, names: Set<string>): void {
	for (let i = 0; i < message.length; i++) {
		if (escaped(message, i)) i += 2;
		else if (message[i] === '{') {
			const end = closing(message, i);
			if (end < 0) return;
			const match = /^\s*(\w+)\s*(?:,\s*(?:select|plural)\s*,([\s\S]*))?$/.exec(message.slice(i + 1, end));
			if (match) {
				names.add(match[1]);
				if (match[2] !== undefined) for (const text of caseTexts(match[2])) collect(text, names);
			}
			i = end;
		}
	}
}

const escaped = (text: string, i: number) => text[i] === "'" && (text[i + 1] === '{' || text[i + 1] === '}') && text[i + 2] === "'";

/** The index of the `}` closing the `{` at `open`; -1 when unclosed. */
function closing(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (escaped(text, i)) i += 2;
		else if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0) return i;
	}
	return -1;
}

/** `one {# hike} other {# hikes}` -> `# hike`, `# hikes`. */
function caseTexts(body: string): string[] {
	const texts: string[] = [];
	let i = 0;
	for (let match; (match = /^\s*[^\s{}]+\s*\{/.exec(body.slice(i))); ) {
		const open = i + match[0].length - 1;
		const end = closing(body, open);
		if (end < 0) break;
		texts.push(body.slice(open + 1, end));
		i = end + 1;
	}
	return texts;
}

/** A paragraph list as one text, the paragraphs apart by a blank line. */
export const toText = (value: StringValue | undefined): string => (Array.isArray(value) ? value.join('\n\n') : (value ?? ''));

/** A textarea's text as the value to save: a paragraph list (`list`) split at blank lines; null when blank. */
export function fromText(text: string, list: boolean): StringValue | null {
	if (!list) return text.trim() === '' ? null : text;
	const paragraphs = text
		.split(/\n[ \t]*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	return paragraphs.length ? paragraphs : null;
}

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';
type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/**
 * One table's save: typed values coalesce per key and are sent together after a pause, on the version last read. A
 * stale version (the IDE, another tab) is a conflict: the edits are kept and nothing more is sent until `load()`, which
 * drops them. A refused save (a broken placeholder) keeps its edits for the next one; a value typed while a save was
 * on its way is never replaced by its answer.
 */
export function createStringsSave(
	lang: string,
	opts: { request?: Request; debounceMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void } = {}
) {
	const request: Request = opts.request ?? api;
	const debounceMs = opts.debounceMs ?? 800;
	const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
	const pending = new Map<string, StringValue | null>();
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((l) => l());
	let timer: unknown = null;
	let chain: Promise<void> = Promise.resolve();

	const stopTimer = () => {
		if (timer !== null) clearTimer(timer);
		timer = null;
	};
	const apply = (r: StringsState) => {
		s.version = r.version;
		s.en = r.en;
		s.own = r.own;
	};

	async function send(): Promise<void> {
		if (s.status === 'conflict' || !pending.size) return;
		const sent = new Map(pending);
		try {
			apply(await request<StringsState>('PATCH', '/api/strings', { lang, base: s.version, set: Object.fromEntries(sent) }));
			for (const [key, value] of sent) if (pending.get(key) === value) pending.delete(key);
			s.status = pending.size ? 'saving' : 'saved';
			s.error = null;
			s.lastSavedAt = Date.now();
		} catch (e) {
			if (e instanceof ApiClientError && e.status === 409) s.status = 'conflict';
			else {
				s.status = 'error';
				s.error = (e as Error).message;
			}
		}
		notify();
	}

	const s = {
		version: '',
		en: {} as Record<string, StringValue>,
		own: {} as Record<string, StringValue>,
		status: 'saved' as SaveStatus,
		error: null as string | null,
		lastSavedAt: null as number | null,
		subscribe(fn: () => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** The values typed and not saved yet, by key (`null` removes). */
		pending: (): Record<string, StringValue | null> => Object.fromEntries(pending),
		set(key: string, value: StringValue | null) {
			pending.delete(key);
			pending.set(key, value);
			if (s.status !== 'conflict') {
				s.status = 'saving';
				stopTimer();
				timer = setTimer(() => {
					timer = null;
					void s.flush();
				}, debounceMs);
			}
			notify();
		},
		flush(): Promise<void> {
			stopTimer();
			chain = chain.then(send);
			return chain;
		},
		/** Resolves once the saves started so far have answered. */
		idle: (): Promise<void> => chain,
		/** Reads the tables again, dropping unsaved edits (and a conflict). */
		async load(): Promise<void> {
			stopTimer();
			await chain;
			apply(await request<StringsState>('GET', `/api/strings?lang=${encodeURIComponent(lang)}`));
			pending.clear();
			s.status = 'saved';
			s.error = null;
			notify();
		}
	};
	return s;
}

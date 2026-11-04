export class ApiClientError extends Error {
	constructor(
		public status: number,
		message: string,
		public body?: unknown
	) {
		super(message);
	}
}

/**
 * Counts the requests this page sent that may write a file (anything but a GET), counted as they start: the freshness
 * check tells a change of the doc's other files (`deps`) this page made from one made elsewhere.
 */
export const ownWrites = { count: 0 };

/** JSON request helper; throws ApiClientError with the server's `error` message. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
	if (method !== 'GET') ownWrites.count++;
	const res = await fetch(path, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		/* empty or non-JSON body */
	}
	if (!res.ok) {
		const msg = (data as { error?: string } | null)?.error ?? res.statusText;
		throw new ApiClientError(res.status, msg, data);
	}
	return data as T;
}

/** Uploads a file as the raw request body (filename in `x-filename`); throws ApiClientError like `api`. */
export async function upload<T = unknown>(path: string, file: File): Promise<T> {
	ownWrites.count++;
	const res = await fetch(path, {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
		body: file
	});
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		/* empty or non-JSON body */
	}
	if (!res.ok) throw new ApiClientError(res.status, (data as { error?: string } | null)?.error ?? res.statusText, data);
	return data as T;
}

/**
 * `upload` with progress (fetch reports none): PUTs `file` as the raw body over XHR, `onProgress` getting the fraction
 * sent. An aborted `signal` rejects with "Upload cancelled"; a connection that breaks off (the server resets one that
 * goes over its limit mid-way) with a plain Error saying so. Server errors throw ApiClientError like `api`.
 */
export function uploadWithProgress<T = unknown>(path: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
	ownWrites.count++;
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', path);
		xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded / e.total);
		};
		xhr.onload = () => {
			let data: unknown = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				/* empty or non-JSON body */
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
			else reject(new ApiClientError(xhr.status, (data as { error?: string } | null)?.error ?? xhr.statusText, data));
		};
		xhr.onerror = () => reject(new Error('The upload broke off: the file is too large, or the connection was lost'));
		xhr.onabort = () => reject(new Error('Upload cancelled'));
		if (signal?.aborted) return reject(new Error('Upload cancelled'));
		signal?.addEventListener('abort', () => xhr.abort(), { once: true });
		xhr.send(file);
	});
}

/**
 * POSTs and reads a text/event-stream response, calling `onLine` for every `data:` line (error responses throw ApiClientError
 * like `api`). Resolves with the last line seen; the server ends with `done` or `error: …`.
 */
export async function streamPost(path: string, onLine: (line: string) => void): Promise<string> {
	ownWrites.count++;
	const res = await fetch(path, { method: 'POST' });
	if (!res.ok) {
		let data: unknown = null;
		try {
			data = await res.json();
		} catch {
			/* empty or non-JSON body */
		}
		throw new ApiClientError(res.status, (data as { error?: string } | null)?.error ?? res.statusText, data);
	}
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let buf = '';
	let last = '';
	const take = (final: boolean) => {
		const parts = buf.split('\n\n');
		buf = final ? '' : (parts.pop() ?? '');
		for (const p of final ? parts.filter(Boolean) : parts) {
			const line = p.replace(/^data: ?/, '');
			last = line;
			onLine(line);
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		take(false);
	}
	take(true);
	return last;
}

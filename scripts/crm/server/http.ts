import type { IncomingMessage, ServerResponse } from 'node:http';
import { STREAMED_ROUTES, type ApiRequest, type ApiResponse } from './api';

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

/** Adapts a Node request to an ApiRequest, runs the API and writes the ApiResponse. */
export async function handleHttp(
	api: (req: ApiRequest) => Promise<ApiResponse>,
	req: IncomingMessage,
	res: ServerResponse
): Promise<void> {
	try {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k] = String(v);
		const apiReq: ApiRequest = {
			method: req.method ?? 'GET',
			path: url.pathname,
			query: url.searchParams,
			headers
		};
		// A streamed route reads the request itself (a video of up to 2 GB is never held in memory).
		if (STREAMED_ROUTES.has(`${apiReq.method.toUpperCase()} ${apiReq.path}`)) apiReq.stream = req;
		else if (apiReq.method !== 'GET' && apiReq.method !== 'HEAD') {
			const body = await readBody(req);
			if (body.length) {
				if ((headers['content-type'] ?? '').includes('application/json')) {
					try {
						apiReq.json = JSON.parse(body.toString('utf8'));
					} catch {
						res.statusCode = 400;
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify({ error: 'Invalid JSON body' }));
						return;
					}
				} else apiReq.body = body;
			}
		}
		const out = await api(apiReq);
		res.statusCode = out.status;
		if (out.binary) {
			res.setHeader('content-type', out.binary.contentType);
			res.setHeader('cache-control', 'max-age=86400');
			res.end(out.binary.body);
		} else if (out.stream) {
			res.setHeader('content-type', 'text/event-stream');
			res.setHeader('cache-control', 'no-cache');
			for await (const line of out.stream) res.write(line);
			res.end();
		} else {
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(out.json ?? null));
		}
	} catch (e) {
		if (!res.headersSent) {
			res.statusCode = 500;
			res.setHeader('content-type', 'application/json');
		}
		res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
	}
}

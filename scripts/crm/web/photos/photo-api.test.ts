import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocSession } from '../doc-session';
import { ApiClientError } from '../api';
import { photoWrite } from './photo-api';

function session(write: (method: string, url: string, body?: any) => any) {
	const calls: string[] = [];
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		if (method === 'GET') return { doc: { slug: 'foo', date: '2024-01-01', version: 'v1', fields: {}, mirrors: [], files: null } };
		calls.push(`${method} ${url} ${JSON.stringify(body ?? null)}`);
		return write(method, url, body);
	};
	return { ses: createDocSession({ kind: 'post', slug: 'foo', date: '2024-01-01' }, { request }), calls, request };
}

test('photoWrite sends the current base (body or query) and adopts the new version', async () => {
	const { ses, calls, request } = session((_m, _u, body) => ({ version: 'v2', echo: body }));
	await ses.load();
	const r = await photoWrite<{ version: string }>(ses, 'POST', '/api/photos/alt', { key: 'k', text: 'x' }, request);
	assert.equal(r.version, 'v2');
	assert.equal(ses.doc!.version, 'v2');
	assert.match(calls[0], /^POST \/api\/photos\/alt\?slug=foo&date=2024-01-01 \{"key":"k","text":"x","base":"v1"\}$/);
	await photoWrite(ses, 'DELETE', '/api/photos/a.jpg', undefined, request);
	assert.match(calls[1], /^DELETE \/api\/photos\/a\.jpg\?slug=foo&date=2024-01-01&base=v2 null$/);
});

test('a 409 refusal without a version (used in the text) is an error; a stale-base 409 raises the conflict banner', async () => {
	const refusing = session(() => {
		throw new ApiClientError(409, 'used in the text — remove it in Write first', { error: 'used in the text — remove it in Write first' });
	});
	await refusing.ses.load();
	await assert.rejects(photoWrite(refusing.ses, 'DELETE', '/api/photos/a.jpg', undefined, refusing.request), /used in the text/);
	assert.equal(refusing.ses.queue.status, 'saved');

	const stale = session(() => {
		throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: 'v9', fields: {}, mirrors: [] });
	});
	await stale.ses.load();
	await assert.rejects(photoWrite(stale.ses, 'POST', '/api/photos/add', { source: 'immich', assetId: 'a' }, stale.request), /conflict banner/);
	assert.equal(stale.ses.queue.status, 'conflict');
});

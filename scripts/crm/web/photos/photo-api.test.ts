import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocSession } from '../doc-session';
import { ApiClientError } from '../api';
import { candidatesQuery, docQuery, photoWrite, refParams } from './photo-api';

function session(write: (method: string, url: string, body?: any) => any) {
	const calls: string[] = [];
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		if (method === 'GET') return { doc: { slug: 'foo', date: '2024-01-01', version: 'v1', fields: {}, mirrors: [], files: null } };
		calls.push(`${method} ${url} ${JSON.stringify(body ?? null)}`);
		return write(method, url, body);
	};
	return { ses: createDocSession({ kind: 'post', slug: 'foo', date: '2024-01-01' }, { request }), calls, request };
}

test('docQuery carries slug and date plus extra params', () => {
	const { ses } = session(() => ({}));
	assert.equal(docQuery(ses), 'slug=foo&date=2024-01-01');
	assert.equal(docQuery(ses, { base: 'v1', key: 'a b' }), 'slug=foo&date=2024-01-01&base=v1&key=a+b');
});

test('the session carries a post or hike ref, and the query is built from it', () => {
	const { ses } = session(() => ({}));
	assert.deepEqual(ses.ref, { kind: 'post', slug: 'foo', date: '2024-01-01' });
	assert.deepEqual(createDocSession({ kind: 'hike', slug: 'foo' }).ref, { kind: 'hike', slug: 'foo' });
	assert.deepEqual(refParams({ kind: 'hike', slug: 'foo' }), { slug: 'foo' });
	assert.equal(docQuery({ ref: { kind: 'place', slug: 'knorrhuette' } }, { key: 'k' }), 'place=knorrhuette&key=k');
});

test('candidatesQuery: album for a post, search text for a place; the date range only when both ends are valid', () => {
	const post = { kind: 'post', slug: 'foo', date: '2024-01-01' } as const;
	const place = { kind: 'place', slug: 'knorrhuette' } as const;
	assert.equal(candidatesQuery(post, { album: 'guess', query: 'x', from: '2024-01-01', to: '2024-01-02' }), 'slug=foo&date=2024-01-01&album=guess&from=2024-01-01&to=2024-01-02');
	assert.equal(candidatesQuery(post, { album: 'none', query: '', from: '2024-01-01', to: '' }), 'slug=foo&date=2024-01-01&album=none');
	assert.equal(candidatesQuery(place, { album: 'guess', query: ' Knorrhütte ', from: '', to: '' }), 'place=knorrhuette&query=Knorrh%C3%BCtte');
	assert.equal(candidatesQuery(place, { album: 'guess', query: '  ', from: '2025-07-01', to: '2025-07-31' }), 'place=knorrhuette&from=2025-07-01&to=2025-07-31');
});

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

test('a 409 refusal without a version (used in the text) is an error, not a conflict', async () => {
	const { ses, request } = session(() => {
		throw new ApiClientError(409, 'used in the text — remove it in Write first', { error: 'used in the text — remove it in Write first' });
	});
	await ses.load();
	await assert.rejects(photoWrite(ses, 'DELETE', '/api/photos/a.jpg', undefined, request), /used in the text/);
	assert.equal(ses.queue.status, 'saved');
});

test('a stale-base 409 raises the conflict banner like the other writes', async () => {
	const { ses, request } = session(() => {
		throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: 'v9', fields: {}, mirrors: [] });
	});
	await ses.load();
	await assert.rejects(photoWrite(ses, 'POST', '/api/photos/add', { source: 'immich', assetId: 'a' }, request), /conflict banner/);
	assert.equal(ses.queue.status, 'conflict');
});

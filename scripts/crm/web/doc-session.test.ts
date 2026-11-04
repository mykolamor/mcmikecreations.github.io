import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocSession, refFromSearch, refSearch } from './doc-session';
import { ApiClientError, ownWrites } from './api';
import type { FieldOp } from '../shared/ops';

function fakeServer() {
	const disk = { version: 'v1', deps: 'd1', files: null as unknown, fields: { 'post.title': 'T' } as Record<string, unknown> };
	const log: string[] = [];
	let gate: Promise<void> | null = null;
	const request = async (method: string, _url: string, body?: any): Promise<any> => {
		if (gate) await gate;
		log.push(`${method}${body ? ' base=' + body.base : ''}`);
		if (method === 'GET')
			return { doc: { slug: 's', date: null, version: disk.version, deps: disk.deps, fields: { ...disk.fields }, mirrors: [], files: disk.files } };
		if (body.base !== disk.version)
			throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: disk.version, fields: { ...disk.fields }, mirrors: [] });
		for (const op of body.ops) disk.fields[op.field] = op.value;
		disk.version = 'v' + (Number(disk.version.slice(1)) + 1);
		return { version: disk.version, fields: { ...disk.fields }, mirrors: [] };
	};
	return { disk, log, request, hold: (g: Promise<void>) => (gate = g), open: () => (gate = null) };
}

test('idle session adopts a newer disk version and shows a reloaded notice', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	s.disk.version = 'v9';
	s.disk.fields['post.title'] = 'IDE';
	await ses.checkFresh();
	assert.equal(ses.doc!.fields['post.title'], 'IDE');
	assert.equal(ses.notice, 'Changed elsewhere — reloaded');
	assert.equal(ses.queue.status, 'saved');
	ses.clearNotice();
	assert.equal(ses.notice, null);
	// the new base is used for the next save
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	assert.equal(s.disk.fields['post.title'], 'Mine');
});

test('pending edits plus a newer disk version raise the conflict', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	ses.edit({ field: 'post.title', value: 'Mine' }, true);
	s.disk.version = 'v9';
	await ses.checkFresh();
	assert.equal(ses.queue.status, 'conflict');
	assert.equal(ses.notice, null);
	assert.equal(s.disk.fields['post.title'], 'T', 'nothing written');
	ses.overwrite();
	await ses.queue.idle();
	assert.equal(s.disk.fields['post.title'], 'Mine');
});

test('a route or shared file changed elsewhere: deps and files taken, the doc and my pending edits kept', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	ses.edit({ field: 'post.title', value: 'Mine' }, true);
	s.disk.deps = 'd2';
	s.disk.files = { gpx: { path: 'x.gpx', km: 3 } };
	await ses.checkFresh();
	assert.equal(ses.doc!.deps, 'd2');
	assert.deepEqual(ses.doc!.files, { gpx: { path: 'x.gpx', km: 3 } });
	assert.equal(ses.notice, 'Route or shared files changed elsewhere — reloaded');
	assert.equal(ses.queue.status, 'saving', 'no conflict: the doc itself is unchanged');
	assert.equal(ses.reloads, 0);
	await ses.queue.flush();
	assert.equal(s.disk.fields['post.title'], 'Mine');
});

test('a deps change after a write of this page is taken without a notice', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	ownWrites.count++; // e.g. an OSM store save from the Map tab
	s.disk.deps = 'd2';
	await ses.checkFresh();
	assert.equal(ses.doc!.deps, 'd2');
	assert.equal(ses.notice, null);
	// The next outside change is said again.
	s.disk.deps = 'd3';
	await ses.checkFresh();
	assert.equal(ses.notice, 'Route or shared files changed elsewhere — reloaded');
});

test('unchanged disk version does nothing', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	await ses.checkFresh();
	assert.equal(ses.notice, null);
});

test('edits made before load resolves wait for the base version', async () => {
	const s = fakeServer();
	let open!: () => void;
	s.hold(new Promise<void>((r) => (open = r)));
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	const loading = ses.load();
	ses.edit({ field: 'post.title', value: 'Early' }, false);
	open();
	s.open();
	await loading;
	await ses.queue.idle();
	assert.deepEqual(s.log.filter((l) => l.startsWith('PATCH')), ['PATCH base=v1']);
	assert.equal(s.disk.fields['post.title'], 'Early');
});

test('409 uses the response body with no second GET; double reload/overwrite is safe', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	s.disk.version = 'v9';
	s.disk.fields['post.title'] = 'IDE';
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict');
	assert.equal(s.log.filter((l) => l === 'GET').length, 1);
	ses.reloadDiscarding();
	ses.reloadDiscarding();
	ses.overwrite();
	assert.equal(ses.doc!.fields['post.title'], 'IDE');
	assert.equal(ses.queue.status, 'saved');
});

test('upload flushes edits first, sends the base and adopts the returned version', async () => {
	const s = fakeServer();
	let url = '';
	const upload = async (u: string): Promise<any> => {
		url = u;
		const base = new URL(u, 'http://x').searchParams.get('base');
		assert.equal(base, s.disk.version);
		s.disk.version = 'v' + (Number(s.disk.version.slice(1)) + 1);
		return { files: { cover: null }, version: s.disk.version };
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request, upload: upload as any });
	await ses.load();
	ses.edit({ field: 'post.title', value: 'Mine' }, true);
	await ses.uploadFile('gpx', { x: '1' }, {} as File);
	assert.equal(s.disk.fields['post.title'], 'Mine', 'edit flushed before the upload');
	assert.match(url, /^\/api\/files\/gpx\?/);
	assert.equal(ses.doc!.version, s.disk.version);
	ses.edit({ field: 'post.title', value: 'Again' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'saved', 'next save uses the adopted base');
});

test('upload 409 raises the conflict; upload is refused during a conflict', async () => {
	const s = fakeServer();
	const upload = async (): Promise<any> => {
		throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: 'v9', fields: {}, mirrors: [] });
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request, upload: upload as any });
	await ses.load();
	await assert.rejects(ses.uploadFile('gpx', {}, {} as File));
	assert.equal(ses.queue.status, 'conflict');
	await assert.rejects(ses.uploadFile('gpx', {}, {} as File), /conflict/i);
});

test('an edit typed during an in-flight upload is sent once afterwards on the upload version, no conflict', async () => {
	const s = fakeServer();
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const upload = async (): Promise<any> => {
		await gate;
		s.disk.version = 'v' + (Number(s.disk.version.slice(1)) + 1);
		return { files: { cover: null }, version: s.disk.version };
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request, upload: upload as any });
	await ses.load();
	s.log.length = 0;
	const up = ses.uploadFile('cover', {}, {} as File);
	await new Promise((r) => setTimeout(r, 0));
	ses.edit({ field: 'post.title', value: 'Typed' }, false);
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(s.log, [], 'nothing sent while the upload runs');
	release();
	await up;
	await ses.queue.idle();
	assert.deepEqual(s.log, ['PATCH base=v2']);
	assert.equal(s.disk.fields['post.title'], 'Typed');
	assert.equal(ses.queue.status, 'saved');
});

test('recomputeMetrics flushes edits, sends the base, adopts version and fields; a 409 raises the conflict', async () => {
	const s = fakeServer();
	const calls: string[] = [];
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		if (method === 'POST') {
			calls.push(url);
			const base = new URL(url, 'http://x').searchParams.get('base');
			if (base !== s.disk.version) throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: s.disk.version, fields: {}, mirrors: [] });
			s.disk.version = 'v' + (Number(s.disk.version.slice(1)) + 1);
			return { version: s.disk.version, fields: { ...s.disk.fields, 'post.extra': 1 } };
		}
		return s.request(method, url, body);
	};
	const ses = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request });
	await ses.load();
	ses.edit({ field: 'post.title', value: 'Mine' }, true);
	await ses.recomputeMetrics();
	assert.equal(s.disk.fields['post.title'], 'Mine', 'edit flushed first');
	assert.match(calls[0], /^\/api\/metrics\/recompute\?slug=s&date=2024-01-01&base=v2$/);
	assert.equal(ses.doc!.version, s.disk.version);
	assert.equal(ses.doc!.fields['post.extra'], 1);
	s.disk.version = 'v9'; // changed elsewhere: our base is stale
	await assert.rejects(ses.recomputeMetrics(), /disk/);
	assert.equal(ses.queue.status, 'conflict');
});

test('overwrite with nothing pending adopts the conflict doc, not just its version', async () => {
	const s = fakeServer();
	const upload = async (): Promise<any> => {
		throw new ApiClientError(409, 'changed on disk', { version: 'v9', fields: { 'post.title': 'IDE' }, mirrors: [{ title: 'M', url: 'u' }] });
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request, upload: upload as any });
	await ses.load();
	await assert.rejects(ses.uploadFile('gpx', {}, {} as File));
	assert.equal(ses.queue.status, 'conflict');
	ses.overwrite();
	assert.equal(ses.doc!.version, 'v9');
	assert.equal(ses.doc!.fields['post.title'], 'IDE');
	assert.deepEqual(ses.doc!.mirrors, [{ title: 'M', url: 'u' }]);
});

test('overwrite keeps pending values on top of the conflict doc', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	s.disk.version = 'v9';
	s.disk.fields['post.title'] = 'IDE';
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	ses.overwrite();
	assert.equal(ses.doc!.fields['post.title'], 'Mine');
	assert.equal(ses.doc!.version, 'v9');
	await ses.queue.idle();
	assert.equal(s.disk.fields['post.title'], 'Mine');
});

test('reloadDiscarding re-reads the doc so files are fresh', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	s.disk.version = 'v9';
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	const gets = s.log.filter((l) => l === 'GET').length;
	await ses.reloadDiscarding();
	assert.equal(s.log.filter((l) => l === 'GET').length, gets + 1);
	assert.equal(ses.doc!.fields['post.title'], 'T');
	assert.equal(ses.queue.status, 'saved');
});

test('doc session builds place URLs', async () => {
	const urls: string[] = [];
	let version = 'v1';
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		urls.push(`${method} ${url}`);
		if (method === 'GET') return { doc: { kind: 'place', slug: 'knorrhuette', version, fields: { 'place.title': 'Knorrhütte' }, body: '' } };
		version = 'v2';
		return { version, fields: { 'place.title': body.ops[0].value }, mirrors: [] };
	};
	const ses = createDocSession({ kind: 'place', slug: 'knorrhuette' }, { request });
	assert.deepEqual(ses.ref, { kind: 'place', slug: 'knorrhuette' });
	assert.equal(ses.slug, 'knorrhuette');
	assert.equal(ses.date, null);
	await ses.load();
	ses.edit({ field: 'place.title', value: 'Knorrhütte (2052 m)' }, false);
	await ses.queue.idle();
	assert.deepEqual(urls, ['GET /api/doc?place=knorrhuette', 'PATCH /api/doc?place=knorrhuette']);
	assert.equal(ses.doc!.fields['place.title'], 'Knorrhütte (2052 m)');
	// the address bar of an open doc, and back
	assert.equal(refSearch({ kind: 'place', slug: 'knorrhuette' }), 'place=knorrhuette');
	assert.equal(refSearch({ kind: 'post', slug: 'foo', date: '2024-01-01' }), 'slug=foo&date=2024-01-01');
	assert.deepEqual(refFromSearch(new URLSearchParams('place=knorrhuette')), { kind: 'place', slug: 'knorrhuette' });
	assert.deepEqual(refFromSearch(new URLSearchParams('slug=foo&date=2024-01-01')), { kind: 'post', slug: 'foo', date: '2024-01-01' });
	assert.deepEqual(refFromSearch(new URLSearchParams('slug=foo')), { kind: 'hike', slug: 'foo' });
	assert.equal(refFromSearch(new URLSearchParams('')), null);
});

test('a re-load that raced a save keeps what the save answered', async () => {
	const s = fakeServer();
	let releaseGet!: () => void;
	let releasePatch!: () => void;
	let staleGet = false;
	const patchGate = new Promise<void>((r) => (releasePatch = r));
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		if (method === 'PATCH') await patchGate;
		if (method === 'GET' && staleGet) {
			// the GET reads the file before the PATCH lands, but answers after it
			const old = await s.request(method, url, body);
			await new Promise<void>((r) => (releaseGet = r));
			return old;
		}
		return s.request(method, url, body);
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request });
	await ses.load();
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await new Promise((r) => setTimeout(r, 0));
	staleGet = true;
	const reload = ses.load();
	await new Promise((r) => setTimeout(r, 0));
	releasePatch();
	await ses.queue.idle();
	releaseGet();
	await reload;
	assert.equal(ses.doc!.fields['post.title'], 'Mine');
	assert.equal(ses.doc!.version, s.disk.version);
});

test('overwrite carries the pending body into the doc and saves it', async () => {
	const disk = { version: 'v1', body: 'Old\n' };
	const request = async (method: string, _url: string, req?: any): Promise<any> => {
		const doc = { slug: 's', date: '2024-01-01', version: disk.version, fields: {}, mirrors: [], files: null, body: disk.body };
		if (method === 'GET') return { doc };
		if (req.base !== disk.version) throw new ApiClientError(409, 'changed on disk', { version: disk.version, fields: {}, mirrors: [], body: disk.body });
		disk.body = req.ops[0].text;
		disk.version = 'v' + (Number(disk.version.slice(1)) + 1);
		return { version: disk.version, fields: {}, mirrors: [], body: disk.body };
	};
	const ses = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request });
	await ses.load();
	disk.body = 'IDE\n';
	disk.version = 'v9';
	ses.edit({ kind: 'body', text: 'Mine\n' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict');
	ses.overwrite();
	assert.equal(ses.doc!.body, 'Mine\n', 'the doc shows my text, not the one in the conflict doc');
	await ses.queue.idle();
	assert.equal(disk.body, 'Mine\n');
});

test('a facts edit queues, survives overwrite and is sent with the other edits', async () => {
	const s = fakeServer();
	const sent: unknown[] = [];
	const request = async (method: string, url: string, body?: any): Promise<any> => {
		if (method === 'PATCH') sent.push(...body.ops.filter((op: any) => op.kind === 'facts'));
		return s.request(method, url, body ? { ...body, ops: body.ops.filter((op: any) => op.kind !== 'facts') } : body);
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request });
	await ses.load();
	s.disk.version = 'v9';
	const facts: FieldOp = { kind: 'facts', scope: 'hike', path: ['legs', 0, 'note'], value: { en: 'N' } };
	ses.edit(facts, false);
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict');
	ses.overwrite();
	assert.equal(ses.doc!.fields['post.title'], 'Mine');
	await ses.queue.idle();
	assert.deepEqual(sent.slice(-1), [facts]);
	assert.equal(ses.queue.status, 'saved');
});

test('a 409 without facts re-reads the doc, so the conflict doc has the facts on disk', async () => {
	const disk = { version: 'v1', facts: { hike: { summary: 'Old' }, post: null } as unknown };
	const log: string[] = [];
	const request = async (method: string, _url: string, req?: any): Promise<any> => {
		log.push(method);
		const doc = { slug: 's', date: null, version: disk.version, fields: {}, mirrors: [], files: null, facts: disk.facts };
		if (method === 'GET') return { doc };
		// a route whose 409 carries no facts (an upload's, a recompute's)
		if (req.base !== disk.version) throw new ApiClientError(409, 'changed on disk', { version: disk.version, fields: {}, mirrors: [] });
		return { version: disk.version, fields: {}, mirrors: [], facts: disk.facts };
	};
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request });
	await ses.load();
	disk.version = 'v9';
	disk.facts = { hike: { summary: 'IDE' }, post: null };
	ses.edit({ kind: 'facts', scope: 'hike', path: ['checked'], value: '2026-10-31' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict');
	assert.deepEqual(log, ['GET', 'PATCH', 'GET']);
	assert.deepEqual((ses.queue.conflictDoc as any).facts, { hike: { summary: 'IDE' }, post: null });
});

test('reloads counts the doc replaced by a version this view did not save', async () => {
	const s = fakeServer();
	const ses = createDocSession({ kind: 'hike', slug: 's' }, { request: s.request });
	await ses.load();
	assert.equal(ses.reloads, 0);
	// My own save, and a check that finds nothing new: not counted.
	ses.edit({ field: 'post.title', value: 'Mine' }, false);
	await ses.queue.idle();
	await ses.checkFresh();
	assert.equal(ses.reloads, 0);
	// A freshness check that adopts a change made elsewhere.
	s.disk.version = 'v9';
	await ses.checkFresh();
	assert.equal(ses.reloads, 1);
	// A conflict is raised: the doc stays; "Reload (discard my unsaved)" replaces it.
	s.disk.version = 'v10';
	ses.edit({ field: 'post.title', value: 'Again' }, true);
	await ses.checkFresh();
	assert.equal(ses.queue.status, 'conflict');
	assert.equal(ses.reloads, 1);
	await ses.reloadDiscarding();
	assert.equal(ses.reloads, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocSession } from '../doc-session';
import { createBodySync, mergeBodies } from './body-sync';
import { ApiClientError } from '../api';

/** A post on "disk": front matter fields and the body, with a version that moves on every write. */
function fakeServer(body: string) {
	const disk = { version: 'v1', fields: { 'post.title': 'T' } as Record<string, unknown>, body };
	const log: string[] = [];
	let gate: Promise<void> | null = null;
	const flags = { failGets: false };
	const doc = () => ({ slug: 's', date: '2024-01-01', version: disk.version, fields: { ...disk.fields }, mirrors: [], files: null, body: disk.body });
	const bump = () => (disk.version = 'v' + (Number(disk.version.slice(1)) + 1));
	const request = async (method: string, _url: string, req?: any): Promise<any> => {
		if (method === 'PATCH' && gate) await gate;
		log.push(`${method}${req ? ' base=' + req.base : ''}`);
		if (method === 'GET') {
			if (flags.failGets) throw new Error('network down');
			return { doc: doc() };
		}
		// A text the server refuses for good (as it does a body on a file without front matter).
		if (req.ops.some((op: any) => op.kind === 'body' && op.text.includes('BAD'))) throw new ApiClientError(400, 'refused', { error: 'refused' });
		if (req.base !== disk.version) {
			const { version, fields, mirrors, body } = doc();
			throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version, fields, mirrors, body });
		}
		for (const op of req.ops) {
			if (op.kind === 'body') disk.body = op.text;
			else disk.fields[op.field] = op.value;
		}
		bump();
		const { version, fields, mirrors, body } = doc();
		return { version, fields, mirrors, body };
	};
	/** Someone else (IDE, phone) edits the file. */
	const external = (text: string) => {
		disk.body = text;
		bump();
	};
	return { disk, log, flags, request, external, bump, hold: (g: Promise<void>) => (gate = g), open: () => (gate = null) };
}

/** The editor, reduced to its text. */
function fakeEditor() {
	const e = { text: '', sets: 0 };
	return Object.assign(e, { get: () => e.text, set: (t: string) => ((e.text = t), e.sets++) });
}

async function open(body: string) {
	const s = fakeServer(body);
	const ses = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request: s.request });
	await ses.load();
	const ed = fakeEditor();
	const sync = createBodySync(ses, ed.get, ed.set);
	const type = (text: string) => {
		ed.text = text;
		sync.changed();
	};
	return { s, ses, ed, sync, type };
}

test('a conflict on a body save keeps the unsaved text for recovery', async () => {
	const { s, ses, ed, sync, type } = await open('Hello\n');
	assert.equal(ed.text, 'Hello\n');
	s.external('Hello from the IDE\n');
	type('Hello mine\n');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict');
	assert.equal(ed.text, 'Hello mine\n', 'the editor keeps my text');
	assert.equal(s.disk.body, 'Hello from the IDE\n', 'nothing written over the IDE edit');
	// "Copy my text" copies what is in the editor, typing during the conflict included.
	type('Hello mine, more\n');
	assert.equal(ses.unsavedBody(), 'Hello mine, more\n');
	// Leaving the tab and coming back shows my text again, not the server's.
	sync.destroy();
	const back = fakeEditor();
	const again = createBodySync(ses, back.get, back.set);
	assert.equal(back.text, 'Hello mine, more\n');
	// Only Reload, chosen by the author, takes the disk text.
	await ses.reloadDiscarding();
	assert.equal(back.text, 'Hello from the IDE\n');
	assert.equal(ses.unsavedBody(), null);
	again.destroy();
});

test('a conflict found by the freshness check while typing keeps the text; Overwrite saves it', async () => {
	const { s, ses, ed, type } = await open('Hello\n');
	type('Hello mine\n');
	s.external('IDE\n');
	await ses.checkFresh();
	assert.equal(ses.queue.status, 'conflict');
	assert.equal(ed.text, 'Hello mine\n');
	ses.overwrite();
	await ses.queue.idle();
	assert.equal(s.disk.body, 'Hello mine\n');
	assert.equal(ed.text, 'Hello mine\n');
	assert.equal(ses.queue.status, 'saved');
});

test('a reload while clean replaces the editor text', async () => {
	const { s, ses, ed } = await open('Hello\n');
	s.external('Hello from the phone\n');
	await ses.checkFresh();
	assert.equal(ed.text, 'Hello from the phone\n');
	assert.equal(ses.queue.pending().length, 0, 'taking the server text is not an edit');
	// A server write that appends to the body (an upload's credit lines) reaches a clean editor too.
	await ses.guardedWrite(async (base) => {
		assert.equal(base, s.disk.version);
		s.disk.body += '\nPhoto: X\n';
		return { version: s.bump() };
	});
	assert.equal(ed.text, 'Hello from the phone\n\nPhoto: X\n');
	assert.equal(ses.queue.pending().length, 0);
});

test('text typed during a server write is kept and the write merged in', async () => {
	const { s, ses, ed, type } = await open('Intro\n\nEnd\n');
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const write = ses.guardedWrite(async () => {
		await gate;
		s.disk.body += '\nPhoto: X\n';
		return { version: s.bump() };
	});
	await new Promise((r) => setTimeout(r, 0));
	type('Intro, typed meanwhile\n\nEnd\n');
	release();
	await write;
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ed.text, 'Intro, typed meanwhile\n\nEnd\n\nPhoto: X\n');
	assert.equal(s.disk.body, 'Intro, typed meanwhile\n\nEnd\n\nPhoto: X\n');
	assert.equal(ses.queue.status, 'saved');
});

test('typing while a save is in flight is not taken for a change elsewhere', async () => {
	const { s, ses, ed, type } = await open('A\n');
	let release!: () => void;
	s.hold(new Promise<void>((r) => (release = r)));
	type('AB\n');
	const first = ses.queue.flush();
	await new Promise((r) => setTimeout(r, 0));
	type('ABC\n');
	s.open();
	release();
	await first;
	assert.equal(ed.text, 'ABC\n', 'the echo of the older save leaves the editor alone');
	assert.notEqual(ses.queue.status, 'conflict');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(s.disk.body, 'ABC\n');
	assert.equal(ses.queue.status, 'saved');
});

test('a save sends exactly the editor text', async () => {
	const { s, ses, type } = await open('No newline at the end');
	type('No newline at the end, still none');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(s.disk.body, 'No newline at the end, still none');
	assert.deepEqual(s.log.filter((l) => l.startsWith('PATCH')), ['PATCH base=v1']);
});

test('typing at the end during an upload that appends credit lines merges both, no conflict', async () => {
	const { s, ses, ed, type } = await open('Intro\n\nEnd\n');
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const write = ses.guardedWrite(async () => {
		await gate;
		s.disk.body += '\nPhoto: X\n';
		return { version: s.bump() };
	});
	await new Promise((r) => setTimeout(r, 0));
	type('Intro\n\nEnd\nA new last line\n');
	release();
	await write;
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'saved');
	assert.equal(ed.text, 'Intro\n\nEnd\nA new last line\n\nPhoto: X\n', 'my text first, then the appended lines');
	assert.equal(s.disk.body, ed.text);
});

test('mergeBodies: a server append after my text without a final newline starts on a line of its own', () => {
	assert.equal(mergeBodies('a\n', 'a\nmine', 'a\n\ncredit\n![](/x.jpg)\n'), 'a\nmine\n\ncredit\n![](/x.jpg)\n');
	// The server already broke the line of a text without a final newline: no second break.
	assert.equal(mergeBodies('a', 'a mine', 'a\n\ncredit\n'), 'a mine\n\ncredit\n');
	assert.equal(mergeBodies('a\n', 'a\nmine\n', 'a\n\ncredit\n'), 'a\nmine\n\ncredit\n');
});

test('mergeBodies: an append at the end goes after my change at the end; real overlaps and touching spans conflict', () => {
	// my insertion at the very end, the server's append there too
	assert.equal(mergeBodies('a\n', 'a\nmine\n', 'a\n\ncredit\n'), 'a\nmine\n\ncredit\n');
	// my edit reaching the end (a deletion of the last line), the server's append
	assert.equal(mergeBodies('a\nb\n', 'a\n', 'a\nb\ncredit\n'), 'a\ncredit\n');
	// both changed the same word
	assert.equal(mergeBodies('one two three', 'one TWO three', 'one 2 three'), null);
	// spans that touch: my insertion right where the server's replacement starts
	assert.equal(mergeBodies('abcdef', 'abXcdef', 'abYYef'), null);
	// two insertions at one point in the middle have no right order
	assert.equal(mergeBodies('ab', 'aXb', 'aYb'), null);
	// a server append is only "at the end" when it is: a server edit ending at the end against my append still conflicts
	assert.equal(mergeBodies('a\nb', 'a\nbc', 'a\nB'), null);
});

test('a failed re-read after a server write never saves over it', async () => {
	const { s, ses, ed, type } = await open('Hello\n');
	s.flags.failGets = true;
	await ses.guardedWrite(async () => {
		s.disk.body += '\nPhoto: X\n';
		return { version: s.bump() };
	});
	// The next guarded write is refused on the client with a clear message, not sent with an empty base.
	let called = false;
	await assert.rejects(
		ses.guardedWrite(async () => ((called = true), { version: 'x' })),
		/Couldn.t confirm the latest version/
	);
	assert.equal(called, false);
	const written = s.disk.body;
	type('Hello mine\n');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'conflict', 'the body save answers 409');
	assert.equal(s.disk.body, written, 'nothing written');
	assert.equal(ed.text, 'Hello mine\n');
	assert.ok(s.log.some((l) => l === 'PATCH base='), 'sent with the unconfirmed (empty) base');
});

test('a failed re-read asks for a freshness check at once', async () => {
	const s = fakeServer('Hello\n');
	let gets = 0;
	// the re-read after the write fails once; the freshness check right after it succeeds
	const request = async (m: string, u: string, b?: any) => {
		if (m === 'GET' && ++gets === 2) throw new Error('blip');
		return s.request(m, u, b);
	};
	const ses = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request });
	await ses.load();
	const ed = fakeEditor();
	createBodySync(ses, ed.get, ed.set);
	await ses.guardedWrite(async () => {
		s.disk.body += '\nPhoto: X\n';
		return { version: s.bump() };
	});
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(gets, 3, 'load, the failed re-read, the freshness check');
	assert.equal(ed.text, 'Hello\n\nPhoto: X\n');
	assert.equal(ses.doc!.version, s.disk.version);
	// confirmed again: guarded writes work
	await ses.guardedWrite(async (base) => ({ version: base }));
});

test('the server going back to my old saved text while I am dirty is not taken for my save', async () => {
	const { s, ses, ed, type } = await open('A\n');
	type('AB\n');
	await ses.queue.flush();
	await ses.queue.idle();
	await ses.guardedWrite(async () => {
		s.disk.body += 'C\n';
		return { version: s.bump() };
	});
	assert.equal(ed.text, 'AB\nC\n');
	type('AB\nC BAD\n'); // refused by the server: stays mine, unsaved
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'error');
	s.external('AB\n'); // the IDE reverts to the text I saved earlier
	await ses.checkFresh();
	assert.equal(ed.text, 'AB\nC BAD\n', 'my text stays');
	assert.equal(ses.queue.status, 'conflict', 'not adopted silently');
});

test('a refused body is not replaced after another field saves', async () => {
	const { s, ses, ed, type } = await open('Intro\n\nEnd\n');
	type('Intro BAD\n\nEnd\n');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'error');
	ses.edit({ field: 'post.title', value: 'New' }, false);
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'saved');
	s.external('Intro\n\nEnd, from the IDE\n');
	await ses.checkFresh();
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ed.text, 'Intro BAD\n\nEnd, from the IDE\n', 'my refused text kept, the IDE change merged in');
	// editing again clears the refusal: after a fixed text is saved, the editor is clean again
	type('Intro fixed\n\nEnd, from the IDE\n');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(ses.queue.status, 'saved');
	s.external('Intro fixed\n\nEnd, from the phone\n');
	await ses.checkFresh();
	assert.equal(ed.text, 'Intro fixed\n\nEnd, from the phone\n');
});

test('a photo-route 409 without a body, then Overwrite: the next keystroke keeps the external text', async () => {
	const { photoWrite } = await import('../photos/photo-api');
	const { s, ses, ed, type } = await open('A\n');
	s.external('A\nIDE paragraph\n');
	// A photo route answering 409 the way it used to: the doc's version and fields, no body.
	const route = async (_m: string, _u: string, req?: any): Promise<any> => {
		if (req.base !== s.disk.version) throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', version: s.disk.version, fields: { ...s.disk.fields }, mirrors: [] });
		return { version: s.bump() };
	};
	await assert.rejects(photoWrite(ses, 'POST', '/api/photos/add', { source: 'immich', assetId: 'a' }, route), /conflict banner/);
	assert.equal(ses.queue.status, 'conflict');
	ses.overwrite();
	await ses.queue.idle();
	assert.equal(ed.text, 'A\nIDE paragraph\n');
	type('A!\nIDE paragraph\n');
	await ses.queue.flush();
	await ses.queue.idle();
	assert.equal(s.disk.body, 'A!\nIDE paragraph\n');
});

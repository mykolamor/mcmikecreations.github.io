import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockTyping, currentBody, editBlock, insertBlock, pairBlocks, replaceBlock, type Pair } from './pairs';
import { createDocSession } from '../doc-session';
import { ApiClientError } from '../api';

const IMG = (n: number) => `![Photo ${n}](/images/projects/data-viz/hikes/stories/demo/p${n}.jpg)`;

/** Each pair as `en | tr`, `-` for an empty side. */
const show = (pairs: Pair[]) => pairs.map((p) => `${p.en?.text ?? '-'} | ${p.tr?.text ?? '-'}`);

test('blocks splits on blank lines and tells media, headings and text apart', () => {
	const body = `Intro\nstill intro\n\n\n## Up\n\n${IMG(1)}\n${IMG(2)}\n\nText ${IMG(3)}\n`;
	const b = blocks(body);
	assert.deepEqual(
		b.map((x) => x.kind),
		['text', 'heading', 'media', 'text']
	);
	assert.equal(b[0].text, 'Intro\nstill intro');
	assert.equal(b[2].anchor, '/images/projects/data-viz/hikes/stories/demo/p1.jpg');
	for (const x of b) assert.equal(body.slice(x.from, x.to), x.text);
});

test('media blocks pair by href and headings by order', () => {
	const en = blocks(`## One\n\n${IMG(1)}\n\n${IMG(2)}\n\n## Two`);
	// The translation dropped photo 1 and swapped nothing else; its headings read differently.
	const tr = blocks(`## Eins\n\n${IMG(2)}\n\n## Zwei`);
	assert.deepEqual(show(pairBlocks(en, tr)), ['## One | ## Eins', `${IMG(1)} | -`, `${IMG(2)} | ${IMG(2)}`, '## Two | ## Zwei']);
});

test('text between anchors pairs by order with gaps', () => {
	const en = blocks(`A1\n\nA2\n\nA3\n\n${IMG(1)}\n\nB1`);
	const tr = blocks(`a1\n\na2\n\n${IMG(1)}\n\nb1\n\nb2`);
	assert.deepEqual(show(pairBlocks(en, tr)), ['A1 | a1', 'A2 | a2', 'A3 | -', `${IMG(1)} | ${IMG(1)}`, 'B1 | b1', '- | b2']);
});

test('a translation-only block keeps its place', () => {
	// A photo only the translation has sits between the two paragraphs it sits between there.
	const en = blocks(`A\n\nB\n\n${IMG(1)}`);
	const tr = blocks(`a\n\n${IMG(9)}\n\nb\n\n${IMG(1)}`);
	assert.deepEqual(show(pairBlocks(en, tr)), ['A | a', `- | ${IMG(9)}`, 'B | b', `${IMG(1)} | ${IMG(1)}`]);
});

test('replaceBlock edits only its block', () => {
	const body = 'A\n\nB b\n\nC\n';
	const b = blocks(body)[1];
	assert.equal(replaceBlock(body, b, 'B2\nmore'), 'A\n\nB2\nmore\n\nC\n');
	// A block whose text also starts another block is still found at its own place.
	const twice = 'Same\n\nSame\n';
	assert.equal(replaceBlock(twice, blocks(twice)[1], 'Other'), 'Same\n\nOther\n');
	// CRLF bodies keep their line breaks.
	assert.equal(replaceBlock('A\r\n\r\nB\r\n', blocks('A\r\n\r\nB\r\n')[1], 'B\nc'), 'A\r\n\r\nB\r\nc\r\n');
});

test('a block edit after the body changed elsewhere lands on its own block or conflicts', () => {
	const old = 'A\n\nB\n\nC\n';
	const b = blocks(old)[1];
	// A paragraph added above (the IDE) moved B: found by its text.
	assert.equal(replaceBlock('New\n\nA\n\nB\n\nC\n', b, 'B2'), 'New\n\nA\n\nB2\n\nC\n');
	// An upload credit appended at the end: B is where it was.
	assert.equal(replaceBlock(old + '\nPhotos: X\n', b, 'B2'), 'A\n\nB2\n\nC\n\nPhotos: X\n');
	// B itself was changed elsewhere: a conflict, never a splice at the old offset.
	assert.equal(replaceBlock('A\n\nB changed\n\nC\n', b, 'B2'), null);
	// B's text is only part of a block now: a conflict.
	assert.equal(replaceBlock('A\n\nX\n\nB and more\n', b, 'B2'), null);
	// B now occurs twice elsewhere: which one is unknown, a conflict.
	assert.equal(replaceBlock('B\n\nA\n\nB\n', { ...b, from: 99, to: 100 }, 'B2'), null);
});

test('clearing a block removes it and one blank line', () => {
	const body = 'A\n\nB\n\nC\n';
	const [a, b, c] = blocks(body);
	assert.equal(replaceBlock(body, b, ''), 'A\n\nC\n');
	assert.equal(replaceBlock(body, a, ''), 'B\n\nC\n');
	assert.equal(replaceBlock(body, c, ''), 'A\n\nB\n');
	assert.equal(replaceBlock('Only\n', blocks('Only\n')[0], ''), '\n');
});

test('insertBlock puts a block after another or at the start', () => {
	const body = 'A\n\nB\n';
	const [a, b] = blocks(body);
	assert.equal(insertBlock(body, a, 'a2'), 'A\n\na2\n\nB\n');
	assert.equal(insertBlock(body, b, 'b2'), 'A\n\nB\n\nb2\n');
	assert.equal(insertBlock(body, null, 'z'), 'z\n\nA\n\nB\n');
	assert.equal(insertBlock('', null, 'z'), 'z\n');
	// Its anchor block changed elsewhere: refused, as a block edit is.
	assert.equal(insertBlock('A changed\n\nB\n', a, 'a2'), null);
});

test('a refused block edit raises the session’s conflict and queues nothing', async () => {
	let body = 'A\n\nB\n';
	const request = async <T>(method: string): Promise<T> => {
		if (method === 'GET') return { doc: { version: 'v1', fields: {}, body } } as T;
		throw new Error('nothing is written');
	};
	const session = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request });
	await session.load();
	const b = blocks(body)[1];
	body = 'A\n\nB edited elsewhere\n';
	await session.load();
	assert.equal(editBlock(session, b, 'B2'), null);
	assert.equal(session.queue.status, 'conflict');
	assert.equal(session.queue.pending().length, 0);
});

/** A post on "disk" whose saves land (a version that moves on each), and that someone else can edit. */
function fakeServer(body: string) {
	const disk = { version: 1, body };
	const doc = () => ({ version: `v${disk.version}`, fields: {}, mirrors: [], body: disk.body });
	const request = async <T>(method: string, _url: string, req?: any): Promise<T> => {
		if (method === 'GET') return { doc: doc() } as T;
		if (req.base !== `v${disk.version}`) throw new ApiClientError(409, 'changed on disk', { error: 'changed on disk', ...doc() });
		for (const op of req.ops) if (op.kind === 'body') disk.body = op.text;
		disk.version++;
		return doc() as T;
	};
	const session = createDocSession({ kind: 'post', slug: 's', date: '2024-01-01' }, { request });
	/** The IDE (or another tab) writes the file. */
	const external = (text: string) => {
		disk.body = text;
		disk.version++;
	};
	return { disk, session, external };
}

test('a block edit queues the whole body and follows its own block', async () => {
	const { disk, session } = fakeServer('A\n\nB\n');
	await session.load();
	const b = blocks('A\n\nB\n')[1];
	const next = editBlock(session, b, 'B2');
	assert.deepEqual(next, { ...b, text: 'B2', to: b.from + 2 });
	assert.equal(session.unsavedBody(), 'A\n\nB2\n');
	// The next keystroke edits the body queued so far.
	editBlock(session, next!, 'B23');
	assert.equal(session.unsavedBody(), 'A\n\nB23\n');
	await session.queue.flush();
	assert.equal(disk.body, 'A\n\nB23\n');
});

test('typing on after the doc was reloaded mid-edit lands or conflicts, never ignored', async () => {
	const { disk, session, external } = fakeServer('A\n\nB\n');
	await session.load();
	const typing = blockTyping(session, blocks('A\n\nB\n')[1], blocks('A\n\nB\n')[0]);
	assert.equal(typing.input('B1'), 'queued');
	await session.queue.flush();
	// The IDE adds a paragraph above; the freshness check reloads the doc while the textarea keeps the focus.
	external('New\n\n' + disk.body);
	await session.checkFresh();
	assert.equal(session.reloads, 1);
	assert.equal(typing.input('B12'), 'queued');
	await session.queue.flush();
	assert.equal(disk.body, 'New\n\nA\n\nB12\n');
	// Now the IDE changes the block itself: the next keystroke raises the conflict and writes nothing.
	external('New\n\nA\n\nB from the IDE\n');
	await session.checkFresh();
	assert.equal(typing.input('B123'), 'conflict');
	assert.equal(session.queue.status, 'conflict');
	assert.equal(session.queue.pending().length, 0);
	// A conflict already open keeps its doc: a keystroke doesn't replace it with the older one.
	const open = session.queue.conflictDoc;
	assert.equal(typing.input('B1234'), 'conflict');
	assert.equal(session.queue.conflictDoc, open);
});

test('a block’s trailing line breaks are trimmed and blank text clears it', async () => {
	const { disk, session } = fakeServer('A\n\nB\n\nC\n');
	await session.load();
	const [a, b] = blocks('A\n\nB\n\nC\n');
	const typed = editBlock(session, b, 'B2\n\n');
	assert.equal(typed?.text, 'B2');
	assert.equal(session.unsavedBody(), 'A\n\nB2\n\nC\n');
	assert.equal(editBlock(session, typed!, '  \n ')?.text, '');
	assert.equal(session.unsavedBody(), 'A\n\nC\n');
	// Blank text typed into an empty side adds nothing; a new block loses its trailing breaks too.
	const typing = blockTyping(session, null, a);
	assert.equal(typing.input('\n'), 'empty');
	assert.equal(typing.input('a2\n'), 'queued');
	assert.equal(session.unsavedBody(), 'A\n\na2\n\nC\n');
	await session.queue.flush();
	assert.equal(disk.body, 'A\n\na2\n\nC\n');
});

test('after Overwrite resolves a typing conflict, the held edit is dropped and typing starts over from the row', async () => {
	const { disk, session, external } = fakeServer('A\n\nB\n');
	await session.load();
	const typing = blockTyping(session, blocks('A\n\nB\n')[1], blocks('A\n\nB\n')[0]);
	external('A\n\nB from the IDE\n');
	await session.checkFresh();
	assert.equal(typing.input('B1'), 'conflict');
	session.overwrite();
	assert.notEqual(session.queue.status, 'conflict');
	// The view drops the held edit when it sees `overwrites` move, and pairs the rows again from the doc.
	assert.equal(session.overwrites, 1);
	const [a, b] = blocks(currentBody(session)!);
	assert.equal(b.text, 'B from the IDE');
	const again = blockTyping(session, b, a);
	assert.equal(again.input('B from the IDE, 2'), 'queued');
	await session.queue.flush();
	assert.equal(disk.body, 'A\n\nB from the IDE, 2\n');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hikeLinkInsert, linePrefix, markMissing, mediaInsert, mediaLines, mentionInsert, missingLinks, wrap, type MdChange } from './md-lines';

/** The body with the change applied, and the text it selects. */
function apply(body: string, c: MdChange | null): { body: string; selected: string } {
	assert.ok(c, 'expected a change');
	const out = body.slice(0, c.from) + c.insert + body.slice(c.to);
	return { body: out, selected: out.slice(c.selFrom, c.selTo) };
}

const BODY = [
	'Intro with an inline ![icon](/images/i.png) image.',
	'',
	'![The ridge at dawn](/images/projects/data-viz/hikes/stories/x/2025-05-11-01.jpg)',
	'',
	'![Road to Buchstein (1701 m) by [David Bilan](https://bilandavid.com/)](/images/projects/data-viz/hikes/stories/x/2025-05-11-08.mp4 "autoplay")',
	'',
	'![The 360° climb](https://www.youtube.com/watch?v=B5yRsnelCsw)',
	'',
	'![Full via ferrata climb](/404/)',
	'',
	'![a](/x.jpg) ![b](/y.jpg)',
	'',
	'A [hike to Herzogstand (1731 m)](/404/) and [Jochberg](/hikes/2024-01-01-jochberg/).',
	''
].join('\n');

test('mediaLines finds photo, video with autoplay, youtube and missing lines and ignores inline images', () => {
	const lines = mediaLines(BODY);
	assert.deepEqual(lines.map((l) => [l.kind, l.caption, l.href]), [
		['photo', 'The ridge at dawn', '/images/projects/data-viz/hikes/stories/x/2025-05-11-01.jpg'],
		['video', 'Road to Buchstein (1701 m) by [David Bilan](https://bilandavid.com/)', '/images/projects/data-viz/hikes/stories/x/2025-05-11-08.mp4'],
		['youtube', 'The 360° climb', 'https://www.youtube.com/watch?v=B5yRsnelCsw'],
		['missing', 'Full via ferrata climb', '/404/']
	]);
	for (const l of lines) {
		assert.equal(BODY.slice(l.captionFrom, l.captionTo), l.caption);
		assert.match(BODY.slice(l.from, l.to), /^!\[.*\)$/);
		assert.ok(BODY[l.from - 1] === '\n' && BODY[l.to] === '\n');
	}
	// A CRLF line ends before its `\r`.
	const crlf = mediaLines('x\r\n![c](/a.jpg)\r\n');
	assert.deepEqual(crlf.map((l) => [l.from, l.to]), [[3, 15]]);
});

test('missingLinks finds [text](/404/) but not missing media', () => {
	const links = missingLinks(BODY);
	assert.deepEqual(links.map((l) => BODY.slice(l.from, l.to)), ['[hike to Herzogstand (1731 m)](/404/)']);
});

test('markMissing turns a link\'s url into /404/', () => {
	const body = 'See [Jochberg](/hikes/2024-01-01-jochberg/) later.';
	const at = body.indexOf('Joch') + 2;
	const r = apply(body, markMissing(body, { from: at, to: at }));
	assert.equal(r.body, 'See [Jochberg](/404/) later.');
	assert.equal(r.selected, 'Jochberg');
	// A plain selection becomes a missing link around it.
	const plain = 'Up Herzogstand next.';
	const from = plain.indexOf('Herzogstand');
	const p = apply(plain, markMissing(plain, { from, to: from + 'Herzogstand'.length }));
	assert.equal(p.body, 'Up [Herzogstand](/404/) next.');
	assert.equal(p.selected, 'Herzogstand');
	// A video keeps its title.
	const video = '![Clip](/v/a.mp4 "autoplay")';
	assert.equal(apply(video, markMissing(video, { from: 3, to: 3 })).body, '![Clip](/404/ "autoplay")');
});

test('mediaInsert adds blank lines only where missing and selects the caption', () => {
	const img = '![Cap](/a.jpg)';
	// On the blank line between two paragraphs.
	const between = 'One.\n\nTwo.';
	let r = apply(between, mediaInsert(between, 5, 'Cap', '/a.jpg'));
	assert.equal(r.body, `One.\n\n${img}\n\nTwo.`);
	assert.equal(r.selected, 'Cap');
	// At the end of a paragraph followed by a blank line.
	const end = 'One.\n\nTwo.';
	r = apply(end, mediaInsert(end, 4, 'Cap', '/a.jpg'));
	assert.equal(r.body, `One.\n\n${img}\n\nTwo.`);
	// Mid-word: moves to the word's end and splits the paragraph there.
	const mid = 'Walking up the ridge.';
	r = apply(mid, mediaInsert(mid, mid.indexOf('up') + 1, 'Cap', '/a.jpg'));
	assert.equal(r.body, `Walking up\n\n${img}\n\nthe ridge.`);
	assert.equal(r.selected, 'Cap');
	// At the start of a line right after another one.
	const start = 'One.\nTwo.';
	r = apply(start, mediaInsert(start, 5, 'Cap', '/a.jpg'));
	assert.equal(r.body, `One.\n\n${img}\n\nTwo.`);
	// At the very start and the very end.
	assert.equal(apply('Two.', mediaInsert('Two.', 0, 'Cap', '/a.jpg')).body, `${img}\n\nTwo.`);
	assert.equal(apply('One.\n', mediaInsert('One.\n', 5, 'Cap', '/a.jpg')).body, `One.\n\n${img}\n`);
	assert.equal(apply('One.', mediaInsert('One.', 4, 'Cap', '/a.jpg')).body, `One.\n\n${img}`);
	assert.equal(apply('One.\nTwo.', mediaInsert('One.\nTwo.', 9, 'Cap', '/a.jpg')).body, `One.\nTwo.\n\n${img}`);
});

test('wrap toggles **bold**, _italic_ and <span lang="de">', () => {
	const body = 'a Hütte b';
	const sel = { body, from: 2, to: 7 };
	let r = apply(body, wrap(sel, '**', '**'));
	assert.equal(r.body, 'a **Hütte** b');
	assert.equal(r.selected, 'Hütte');
	// Again, with the inner text selected: unwraps.
	const bold = r.body;
	r = apply(bold, wrap({ body: bold, from: 4, to: 9 }, '**', '**'));
	assert.equal(r.body, body);
	assert.equal(r.selected, 'Hütte');
	// Or with the markers selected too.
	assert.equal(apply(bold, wrap({ body: bold, from: 2, to: 11 }, '**', '**')).body, body);
	// Italic doesn't take bold's stars for its own.
	assert.equal(apply(bold, wrap({ body: bold, from: 4, to: 9 }, '_', '_')).body, 'a **_Hütte_** b');
	const de = apply(body, wrap(sel, '<span lang="de">', '</span>'));
	assert.equal(de.body, 'a <span lang="de">Hütte</span> b');
	assert.equal(apply(de.body, wrap({ body: de.body, from: 18, to: 23 }, '<span lang="de">', '</span>')).body, body);
	// An empty selection gets both markers with the cursor between.
	r = apply(body, wrap({ body, from: 2, to: 2 }, '_', '_'));
	assert.equal(r.body, 'a __Hütte b');
	assert.equal(r.selected, '');
});

test('linePrefix toggles headings, quotes and lists', () => {
	const body = 'One\nTwo\n\nThree';
	const lines = [{ from: 0, text: 'One' }, { from: 4, text: 'Two' }];
	let r = apply(body, linePrefix(lines, '- '));
	assert.equal(r.body, '- One\n- Two\n\nThree');
	r = apply(r.body, linePrefix([{ from: 0, text: '- One' }, { from: 6, text: '- Two' }], '- '));
	assert.equal(r.body, body);
	// A single line: the cursor goes to its end.
	const h = linePrefix([{ from: 9, text: 'Three' }], '## ');
	r = apply(body, h);
	assert.equal(r.body, 'One\nTwo\n\n## Three');
	assert.equal(h.selFrom, r.body.length);
	assert.equal(h.selTo, r.body.length);
	// Blank lines inside a block stay blank.
	assert.equal(apply(body, linePrefix([{ from: 4, text: 'Two' }, { from: 8, text: '' }, { from: 9, text: 'Three' }], '> ')).body, 'One\n> Two\n\n> Three');
});

test('hikeLinkInsert writes the post link and selects the title', () => {
	const r = apply('Via .', hikeLinkInsert(4, 'Jochberg', '2024-01-01', 'jochberg'));
	assert.equal(r.body, 'Via [Jochberg](/hikes/2024-01-01-jochberg/).');
	assert.equal(r.selected, 'Jochberg');
});

test('mentionInsert writes Name (ele m) and plain Name without ele', () => {
	const body = 'Up to Knor today';
	const c = mentionInsert(6, 10, { lat: 47.4, lon: 11, tags: { name: 'Knorrhütte', ele: '2051.6' } });
	const r = apply(body, c);
	assert.equal(r.body, 'Up to Knorrhütte (2052 m) today');
	assert.equal(c.selFrom, c.selTo);
	assert.equal(c.selFrom, 6 + 'Knorrhütte (2052 m)'.length);
	assert.equal(apply(body, mentionInsert(6, 10, { lat: 1, lon: 1, tags: { name: 'Marienstein' } })).body, 'Up to Marienstein today');
});

test('markMissing acts on a link the selection partly overlaps, from either side', () => {
	const body = 'see [Foo](/x/) more';
	// From before the link into it.
	assert.equal(apply(body, markMissing(body, { from: 0, to: 7 })).body, 'see [Foo](/404/) more');
	// From inside the link past its end.
	const r = apply(body, markMissing(body, { from: 7, to: 17 }));
	assert.equal(r.body, 'see [Foo](/404/) more');
	assert.equal(r.selected, 'Foo');
	// Ends in two different links, or a whole link inside a plain selection: no-op.
	const two = 'a [B](/b/) c [D](/d/) e';
	assert.equal(markMissing(two, { from: 4, to: 15 }), null);
	assert.equal(markMissing(two, { from: 0, to: 12 }), null);
});

test('markMissing is a no-op for a cursor outside links and across a line break', () => {
	const body = 'One two.\nThree.';
	assert.equal(markMissing(body, { from: 2, to: 2 }), null);
	assert.equal(markMissing(body, { from: 4, to: 11 }), null);
});

test('mediaInsert keeps indentation, trims the split and keeps CRLF', () => {
	const img = '![Cap](/a.jpg)';
	// At the start of an indented line: the line stays as it is.
	const indented = 'One.\n  - item';
	assert.equal(apply(indented, mediaInsert(indented, 5, 'Cap', '/a.jpg')).body, `One.\n\n${img}\n\n  - item`);
	// Right after a space: the space doesn't stay at the end of the line.
	const mid = 'Walking up the ridge.';
	assert.equal(apply(mid, mediaInsert(mid, mid.indexOf('the'), 'Cap', '/a.jpg')).body, `Walking up\n\n${img}\n\nthe ridge.`);
	// CRLF bodies get CRLF.
	const crlf = 'One.\r\nTwo.\r\n';
	const r = apply(crlf, mediaInsert(crlf, 6, 'Cap', '/a.jpg'));
	assert.equal(r.body, `One.\r\n\r\n${img}\r\n\r\nTwo.\r\n`);
	assert.equal(r.selected, 'Cap');
});

test('mediaLines allows whitespace around a media line', () => {
	const body = 'x\n  ![Cap](/a.jpg)  \n';
	const [line] = mediaLines(body);
	assert.equal(body.slice(line.from, line.to), '![Cap](/a.jpg)');
	assert.equal(line.caption, 'Cap');
});

test('wrap only unwraps a single wrapped run', () => {
	const body = '_a_ and _b_';
	assert.equal(apply(body, wrap({ body, from: 0, to: body.length }, '_', '_')).body, '__a_ and _b__');
	// The inner text between the outer markers wraps too.
	assert.equal(apply(body, wrap({ body, from: 1, to: body.length - 1 }, '_', '_')).body, '__a_ and _b__');
});

test('linePrefix swaps heading levels and keeps CRLF', () => {
	assert.equal(apply('### x', linePrefix([{ from: 0, text: '### x' }], '## ')).body, '## x');
	assert.equal(apply('## x', linePrefix([{ from: 0, text: '## x' }], '## ')).body, 'x');
	const crlf = 'One\r\nTwo';
	assert.equal(apply(crlf, linePrefix([{ from: 0, text: 'One' }, { from: 5, text: 'Two' }], '- ')).body, '- One\r\n- Two');
});

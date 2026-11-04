import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editFrontmatter, flowEntry, readFrontmatterDoc, writeFrontmatterDoc } from './frontmatter';

const HIKES = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/', import.meta.url));

function realFiles(): string[] {
	return ['markdown', 'places'].flatMap((d) =>
		readdirSync(join(HIKES, d))
			.filter((f) => f.endsWith('.md'))
			.map((f) => join(HIKES, d, f))
	);
}

test('every real post and place doc round-trips byte-identically', () => {
	const files = realFiles();
	assert.ok(files.length > 50);
	for (const file of files) {
		const raw = readFileSync(file, 'utf8');
		const { doc, body } = readFrontmatterDoc(raw);
		assert.equal(writeFrontmatterDoc(doc, body), raw, file);
	}
});

test('adding one images entry leaves the rest untouched', async () => {
	const source = realFiles().find((f) => /markdown\/.*\.md$/.test(f) && /^images:\n {2}\S+: \{/m.test(readFileSync(f, 'utf8')))!;
	const raw = readFileSync(source, 'utf8');
	const dir = mkdtempSync(join(tmpdir(), 'fm-'));
	const copy = join(dir, 'post.md');
	writeFileSync(copy, raw);

	const changed = await editFrontmatter(copy, (doc) => {
		const images = doc.get('images') as { set(k: string, v: unknown): void };
		images.set('zz-new.jpg', flowEntry(doc, { w: 100, h: 50, lat: 47.5, taken: '2025-01-02T03:04:05+01:00', blur: 'data:image/webp;base64,AAAA' }));
	});
	assert.equal(changed, true);

	const newLine = "  zz-new.jpg: {w: 100, h: 50, lat: 47.5, taken: '2025-01-02T03:04:05+01:00', blur: 'data:image/webp;base64,AAAA'}\n";
	const lines = raw.split('\n');
	// the entry lands after the last images entry
	let last = lines.findIndex((l) => l === 'images:');
	while (/^ {2}\S/.test(lines[last + 1] ?? '')) last++;
	const expected = [...lines.slice(0, last + 1), newLine.slice(0, -1), ...lines.slice(last + 1)].join('\n');
	assert.equal(readFileSync(copy, 'utf8'), expected);
});

test('a no-op edit reports no change and does not touch the file', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'fm-'));
	const copy = join(dir, 'post.md');
	writeFileSync(copy, readFileSync(realFiles()[0], 'utf8'));
	assert.equal(await editFrontmatter(copy, () => {}), false);
});

test('comments, quoting and body survive an edit', () => {
	const raw = "---\n# keep me\ntitle: 'Quoted' # trailing\nascent: 10\n---\nBody\n";
	const { doc, body } = readFrontmatterDoc(raw);
	doc.set('ascent', 11);
	assert.equal(writeFrontmatterDoc(doc, body), raw.replace('ascent: 10', 'ascent: 11'));
});

test('front matter that cannot be parsed (CRLF, unterminated) throws instead of reading as absent', () => {
	assert.throws(() => readFrontmatterDoc('---\r\ntitle: X\r\n---\r\nBody\r\n'), /front matter/i);
	assert.throws(() => readFrontmatterDoc('---\ntitle: X\nBody\n'), /front matter/i);
	assert.doesNotThrow(() => readFrontmatterDoc('Body only\n'));
	assert.doesNotThrow(() => readFrontmatterDoc('----\nrule-like\n'));
});

test('an empty front matter block (`---\\n---\\n`, as created posts start) parses and takes edits', () => {
	const { doc, body } = readFrontmatterDoc('---\n---\nBody\n');
	assert.equal(body, 'Body\n');
	assert.equal(writeFrontmatterDoc(doc, body), '---\n---\nBody\n');
	doc.set('title', 'T');
	assert.equal(writeFrontmatterDoc(doc, body), '---\ntitle: T\n---\nBody\n');
	assert.equal(writeFrontmatterDoc(readFrontmatterDoc('---\n---\n').doc, ''), '---\n---\n');
});

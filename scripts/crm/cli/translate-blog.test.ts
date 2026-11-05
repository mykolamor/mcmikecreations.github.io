import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deeplStub } from '../server/deepl';
import { buildBlogIndex } from '../../../src/lib/blog/blog-index.server';
import { parseArgs } from './index';
import { recorder } from './test-output';
import { findBlogPost, runTranslateBlog, splitBody } from './translate-blog';

const BODY = [
	'# Title',
	'',
	'Some `inline` text with a [link](https://example.com).',
	'',
	'```ts',
	'const x = 1;',
	'',
	'// a comment',
	'```',
	'',
	'    indented code',
	'    more',
	'',
	'![Diagram.](/images/blog/x/d.svg "invert")',
	'',
	'[id]: https://example.com "Ref"',
	''
].join('\n');

test('splitBody keeps code and link definitions, and gives the body back exactly', () => {
	const parts = splitBody(BODY);
	assert.equal(parts.map((p) => p.text).join(''), BODY);
	const sent = parts.filter((p) => p.translate).map((p) => p.text.trim());
	assert.deepEqual(sent, ['# Title', 'Some `inline` text with a [link](https://example.com).', '![Diagram.](/images/blog/x/d.svg "invert")']);
	assert.ok(parts.some((p) => !p.translate && p.text.includes('const x = 1;\n\n// a comment')));
	// an unclosed fence runs to the end
	assert.deepEqual(splitBody('a\n```\ncode\n\nmore'), [{ text: 'a\n', translate: true }, { text: '```\ncode\n\nmore', translate: false }]);
});

function setup() {
	const root = mkdtempSync(join(tmpdir(), 'crm-cli-translate-blog-'));
	const dir = join(root, 'static/_blog');
	mkdirSync(dir, { recursive: true });
	const post = join(dir, '2024-03-01-x.md');
	writeFileSync(post, `---\ntitle: 'X: the post'\ndate: '2024-03-01'\ndescription: About X.\ntags: [Backend]\n---\n${BODY}`);
	return { root, post, de: join(dir, '2024-03-01-x.de.md') };
}

const go = (root: string, argv: string[]) => {
	const out = recorder();
	return runTranslateBlog(root, parseArgs(['translate-blog', ...argv]), out, deeplStub).then((code) => ({ code, out }));
};

test('translate-blog drafts the translation, code untouched, and the site reads it', async () => {
	const { root, post, de } = setup();
	const dry = await go(root, ['x', 'de', '--dry-run']);
	assert.equal(dry.code, 0);
	assert.ok(!existsSync(de));

	const { code, out } = await go(root, ['x', 'de']);
	assert.equal(code, 0, out.warnings.join('\n'));
	const text = readFileSync(de, 'utf8');
	assert.match(text, /^---\ntitle: "⟨de⟩ X: the post"\ndescription: ⟨de⟩ About X\.\n---\n/);
	assert.doesNotMatch(text, /section:|date:|tags:/);
	assert.ok(text.includes('# ⟨de⟩ Title\n'));
	assert.ok(text.includes('```ts\nconst x = 1;\n\n// a comment\n```\n'));
	assert.ok(text.includes('    indented code\n    more\n'));
	assert.ok(text.includes('[id]: https://example.com "Ref"\n'));
	assert.ok(text.includes('](/images/blog/x/d.svg "invert")'));

	// the site takes it as the German version of the post
	const index = buildBlogIndex({ '2024-03-01-x.md': readFileSync(post, 'utf8'), '2024-03-01-x.de.md': text }, { mediaExists: () => true });
	assert.equal(index.translations.get('2024-03-01-x.md')?.de?.title, '⟨de⟩ X: the post');

	// never overwrites
	const again = await go(root, ['2024-03-01-x', 'de']);
	assert.equal(again.code, 1);
	assert.equal(readFileSync(de, 'utf8'), text);
});

test('translate-blog refuses unknown posts and languages', async () => {
	const { root } = setup();
	assert.equal((await go(root, ['nope', 'de'])).code, 1);
	assert.equal((await go(root, ['x', 'fr'])).code, 2);
	assert.equal((await go(root, ['x', 'en'])).code, 2);
	assert.equal((await go(root, ['x'])).code, 2);
	assert.equal(findBlogPost(root, '2024-03-01-x.md'), join(root, 'static/_blog/2024-03-01-x.md'));
});

// Run with: node_modules/.bin/jiti src/lib/i18n/strings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { missingKeys, stringTables, syntaxErrors, t, TABLES, tablesFor, type Table } from './strings';
import { LANGS } from './languages';
import { paragraphs, paragraphsOf } from './paragraphs';

const fixture = stringTables({
	en: {
		list: {
			title: 'Hikes',
			page: 'Hikes{page, select, 1 {} other { - Page {page}}}',
			count: '{count, plural, one {# hike} other {# hikes}}',
			near: 'Hikes near {place}',
			braces: "Write '{'name'}' for a placeholder, it's {name}",
			intro: ['Some *hikes* near [Munich](/hikes/).', 'A second paragraph.']
		},
		only: { en: 'English only' }
	},
	de: {
		list: {
			title: 'Wanderungen',
			count: '{count, plural, one {# Wanderung} other {# Wanderungen}}',
			intro: ['Ein paar **Touren**.']
		}
	}
});

test('t falls back to English per key', () => {
	assert.equal(fixture.t('de', 'list.title'), 'Wanderungen');
	assert.equal(fixture.t('de', 'only.en'), 'English only');
	assert.equal(fixture.t('de', 'list.near', { place: 'Garmisch' }), 'Hikes near Garmisch');
	assert.equal(fixture.t('en', 'list.title'), 'Hikes');
	assert.deepEqual(paragraphsOf(fixture)('de', 'list.intro'), ['Ein paar <strong>Touren</strong>.']);
});

test('t fills placeholders and the select/plural forms', () => {
	assert.equal(fixture.t('en', 'list.near', { place: 'Garmisch' }), 'Hikes near Garmisch');
	assert.equal(fixture.t('en', 'list.page', { page: 1 }), 'Hikes');
	assert.equal(fixture.t('en', 'list.page', { page: 3 }), 'Hikes - Page 3');
	assert.equal(fixture.t('en', 'list.count', { count: 1 }), '1 hike');
	assert.equal(fixture.t('en', 'list.count', { count: 0 }), '0 hikes');
	assert.equal(fixture.t('en', 'list.count', { count: 12 }), '12 hikes');
	assert.equal(fixture.t('de', 'list.count', { count: 1 }), '1 Wanderung');
	assert.equal(fixture.t('de', 'list.count', { count: 2 }), '2 Wanderungen');
	assert.equal(fixture.t('en', 'list.braces', { name: 'x' }), "Write {name} for a placeholder, it's x");
	assert.throws(() => fixture.t('en', 'list.near'), /list\.near.*place/);
});

test('t throws when a plural parameter is not a number', () => {
	assert.throws(() => fixture.t('en', 'list.count', { count: 'many' }), /list\.count.*count.*number/);
	assert.throws(() => fixture.t('en', 'list.count', { count: '' }), /list\.count.*count.*number/);
	assert.equal(fixture.t('en', 'list.count', { count: 2 }), '2 hikes');
});

test('a plural form takes only the CLDR case names', () => {
	const odd = stringTables({
		en: {
			exact: '{n, plural, =0 {none} other {# hikes}}',
			named: '{n, plural, lots {many} other {# hikes}}',
			fine: '{n, plural, zero {none} one {#} two {#} few {#} many {#} other {#}}'
		}
	});
	assert.throws(() => odd.t('en', 'exact', { n: 0 }), /exact.*"=0"/);
	assert.throws(() => odd.t('en', 'named', { n: 5 }), /named.*"lots"/);
	assert.equal(odd.t('en', 'fine', { n: 5 }), '5');
});

test('syntaxErrors checks every string and every branch', () => {
	assert.deepEqual(
		syntaxErrors({
			ok: 'Hikes{page, select, 1 {} other { - Page {page}}}',
			// A paragraph list is markdown, read verbatim: a brace in it is text.
			list: ['fine', 'a {brace'],
			nested: {
				deep: '{n, plural, one {# {x, select, a {b} other {c} d}} other {#}}',
				exact: '{n, plural, =1 {one} other {#}}',
				noOther: '{n, select, a {b}}',
				stray: 'a } b',
				bad: '{a b}'
			}
		}),
		[
			'nested.deep: bad form case "d"',
			'nested.exact: plural case "=1" is not one of zero, one, two, few, many, other',
			'nested.noOther: "n" has no "other" case',
			'nested.stray: unmatched "}"',
			'nested.bad: bad placeholder "{a b}"'
		]
	);
});

test('every string in en.json and de.json is well-formed', () => {
	assert.deepEqual(syntaxErrors(readTable('en')), []);
	assert.deepEqual(syntaxErrors(readTable('de')), []);
});

test('tSplit cuts a string at one placeholder', () => {
	assert.deepEqual(fixture.tSplit('en', 'list.near', 'place'), ['Hikes near ', '']);
	assert.deepEqual(fixture.tSplit('en', 'list.braces', 'name'), ["Write {name} for a placeholder, it's ", '']);
	assert.throws(() => fixture.tSplit('en', 'list.title', 'page'), /list\.title.*\{page\}/);
});

test('tHtml escapes the string\'s own text for an HTML string, not its params', () => {
	const html = stringTables({ en: { x: { tags: `Tom & Jerry's <b>{name}</b> "{n, plural, one {# cat} other {# cats}}"` } } });
	assert.equal(html.tHtml('en', 'x.tags', { name: '<i>Tom</i>', n: 2 }), 'Tom &amp; Jerry&#39;s &lt;b&gt;<i>Tom</i>&lt;/b&gt; &quot;2 cats&quot;');
	// Plain text reads as t() does.
	assert.equal(fixture.tHtml('de', 'list.near', { place: 'Garmisch' }), fixture.t('de', 'list.near', { place: 'Garmisch' }));
});

test('t throws on a key English lacks', () => {
	assert.throws(() => fixture.t('en', 'list.nope'), /list\.nope/);
	assert.throws(() => fixture.t('de', 'nope'), /nope/);
	// A group or a paragraph list is not a string.
	assert.throws(() => fixture.t('en', 'list'), /list/);
	assert.throws(() => fixture.t('en', 'list.intro'), /list\.intro/);
	assert.throws(() => paragraphsOf(fixture)('en', 'list.title'), /list\.title/);
	assert.throws(() => paragraphs('en', 'no.such.key'), /no\.such\.key/);
	assert.throws(() => t('en', 'no.such.key'), /no\.such\.key/);
});

test('paragraphs renders inline markdown per paragraph', () => {
	assert.deepEqual(paragraphsOf(fixture)('en', 'list.intro'), [
		'Some <em>hikes</em> near <a href="/hikes/">Munich</a>.',
		'A second paragraph.'
	]);
});

test('paragraphs escapes text and passes inline HTML through, as marked does', () => {
	const escaping = paragraphsOf(stringTables({
		en: { p: [`a < b & "c" it's`, 'Tom &amp; Jerry&nbsp;too', 'x <b>bold</b>', '[link](/a?b=1&c=2 "say \\"hi\\"")'] }
	}));
	assert.deepEqual(escaping('en', 'p'), [
		'a &lt; b &amp; &quot;c&quot; it&#39;s',
		'Tom &amp; Jerry&nbsp;too',
		'x <b>bold</b>',
		'<a href="/a?b=1&c=2" title="say &quot;hi&quot;">link</a>'
	]);
});

test('missingKeys lists German gaps', () => {
	assert.deepEqual(fixture.missingKeys('de'), ['list.page', 'list.near', 'list.braces', 'only.en']);
	assert.deepEqual(fixture.missingKeys('en'), []);
	assert.deepEqual(missingKeys('en'), []);
	// The real tables: German holds no key English lacks (swapped, its extras are the gaps).
	assert.deepEqual(stringTables({ en: readTable('de'), de: readTable('en') }).missingKeys('de'), []);
});

test('every t(), tSplit(), tHtml(), paragraphs() and paragraphTexts() key in the code exists in en.json', () => {
	const call = /\b(?:t|tSplit|tHtml|paragraphs|paragraphTexts)\(\s*[\w.]+\s*,\s*'([^']+)'/g;
	for (const file of sourceFiles(path.resolve('src'))) {
		if (/(strings|paragraphs)\.test\.ts$/.test(file)) continue;
		for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(call)) {
			assert.notEqual(lookup(readTable('en'), key), undefined, `${path.relative('.', file)}: ${key}`);
		}
	}
});

test('strings.ts is the string tables\' one importer', () => {
	const json = new RegExp(`from\\s+'[^']*i18n\\/(?:${LANGS.join('|')})\\.json'`);
	const importers = [...sourceFiles(path.resolve('src'))]
		.filter((file) => !file.endsWith('.test.ts') && json.test(fs.readFileSync(file, 'utf8')))
		.map((file) => path.relative('.', file));
	assert.deepEqual(importers, ['src/lib/i18n/strings.ts']);
});

test('the site has one table per language in LANGS, each imported once in strings.ts', () => {
	assert.deepEqual(Object.keys(TABLES), [...LANGS]);
	for (const lang of LANGS) assert.deepEqual(TABLES[lang], readTable(lang), lang);
	const files = fs.readdirSync(path.resolve('src/lib/hikes/i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
	assert.deepEqual(files.sort(), [...LANGS].sort(), 'every table is a language in LANGS');
	const source = fs.readFileSync(path.resolve('src/lib/i18n/strings.ts'), 'utf8');
	for (const lang of LANGS) assert.match(source, new RegExp(`^import \\w+ from '\\.\\./hikes/i18n/${lang}\\.json';$`, 'm'), lang);
});

test('the tables are built from the language list', () => {
	const en = { a: 'A' };
	const uk = { a: 'Ä' };
	assert.deepEqual(tablesFor(['en', 'uk'], { en, uk }), { en, uk });
	assert.throws(() => tablesFor(['en', 'uk'], { en }), /No string table for "uk"/);
	assert.throws(() => tablesFor(['en'], { en, uk }), /string table for "uk", which is not in LANGS/);
});

function readTable(lang: string): Table {
	return JSON.parse(fs.readFileSync(path.resolve(`src/lib/hikes/i18n/${lang}.json`), 'utf8'));
}

function lookup(table: Table, key: string): unknown {
	return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table);
}

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(full);
		else if (/\.(ts|js|svelte)$/.test(entry.name)) yield full;
	}
}

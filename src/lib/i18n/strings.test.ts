// Run with: node_modules/.bin/jiti src/lib/i18n/strings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stringTables, syntaxErrors, TABLES, type Table } from './strings';
import { LANGS } from './languages';
import { paragraphsOf } from './paragraphs';

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

test('t falls back to English per key and fills placeholders, select and plural forms', () => {
	assert.equal(fixture.t('de', 'list.title'), 'Wanderungen');
	assert.equal(fixture.t('de', 'only.en'), 'English only');
	assert.equal(fixture.t('de', 'list.near', { place: 'Garmisch' }), 'Hikes near Garmisch');
	assert.deepEqual(paragraphsOf(fixture)('de', 'list.intro'), ['Ein paar <strong>Touren</strong>.']);
	assert.equal(fixture.t('en', 'list.page', { page: 1 }), 'Hikes');
	assert.equal(fixture.t('en', 'list.page', { page: 3 }), 'Hikes - Page 3');
	assert.equal(fixture.t('en', 'list.count', { count: 0 }), '0 hikes');
	assert.equal(fixture.t('de', 'list.count', { count: 1 }), '1 Wanderung');
	assert.equal(fixture.t('en', 'list.braces', { name: 'x' }), "Write {name} for a placeholder, it's x");
	assert.throws(() => fixture.t('en', 'list.near'), /list\.near.*place/);
	assert.throws(() => fixture.t('en', 'list.nope'), /list\.nope/);
});

test('a plural takes only a number and only the CLDR case names', () => {
	assert.throws(() => fixture.t('en', 'list.count', { count: 'many' }), /list\.count.*count.*number/);
	assert.throws(() => fixture.t('en', 'list.count', { count: '' }), /list\.count.*count.*number/);
	const odd = stringTables({
		en: {
			exact: '{n, plural, =0 {none} other {# hikes}}',
			named: '{n, plural, lots {many} other {# hikes}}'
		}
	});
	assert.throws(() => odd.t('en', 'exact', { n: 0 }), /exact.*"=0"/);
	assert.throws(() => odd.t('en', 'named', { n: 5 }), /named.*"lots"/);
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

test('tHtml escapes the string\'s own text for an HTML string, not its params', () => {
	const html = stringTables({ en: { x: { tags: `Tom & Jerry's <b>{name}</b> "{n, plural, one {# cat} other {# cats}}"` } } });
	assert.equal(html.tHtml('en', 'x.tags', { name: '<i>Tom</i>', n: 2 }), 'Tom &amp; Jerry&#39;s &lt;b&gt;<i>Tom</i>&lt;/b&gt; &quot;2 cats&quot;');
});

test('every string in every language table is well-formed', () => {
	for (const lang of LANGS) assert.deepEqual(syntaxErrors(readTable(lang)), [], lang);
});

test('no translation holds a key English lacks', () => {
	// Swapped, the translation's extras are the gaps.
	for (const lang of LANGS.slice(1)) {
		assert.deepEqual(stringTables({ en: readTable(lang), de: readTable('en') }).missingKeys('de'), [], lang);
	}
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

test('the site has one table per language in LANGS', () => {
	assert.deepEqual(Object.keys(TABLES), [...LANGS]);
	const files = fs.readdirSync(path.resolve('src/lib/hikes/i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
	assert.deepEqual(files.sort(), [...LANGS].sort(), 'every table is a language in LANGS');
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
